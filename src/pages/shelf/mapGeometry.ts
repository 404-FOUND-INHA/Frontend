import type { ShelfResponse } from '@/types/scan/shelf'

// 서가 배치도의 좌표 계산(순수 함수). 화면 좌표 = 지도 좌표 × scale + (x, y).
// 서가 좌표의 해석은 shelfShape에만 둔다. API 계약에 정해져 있지 않아 다음과 같이 가정한다: 단위는 cm,
// (mapX, mapY)는 서가의 중심, x는 오른쪽·y는 아래, rotationDegree는 시계 방향이고 0이면 폭이 x축이다.

export const DEFAULT_SHELF_WIDTH_CM = 90
export const DEFAULT_SHELF_DEPTH_CM = 30

export interface ShelfShape {
  cx: number
  cy: number
  width: number
  depth: number
  rotation: number
  /** 폭이나 깊이가 없어 기본 크기를 쓴다. */
  sizeUnknown: boolean
}

/** 좌표가 하나라도 없으면 지도에 놓을 수 없다. */
export function shelfShape(
  shelf: Pick<ShelfResponse, 'mapX' | 'mapY' | 'widthCm' | 'depthCm' | 'rotationDegree'>,
): ShelfShape | null {
  const { mapX, mapY, widthCm, depthCm, rotationDegree } = shelf
  if (mapX === null || mapY === null) return null
  return {
    cx: mapX,
    cy: mapY,
    width: widthCm || DEFAULT_SHELF_WIDTH_CM,
    depth: depthCm || DEFAULT_SHELF_DEPTH_CM,
    rotation: rotationDegree ?? 0,
    sizeUnknown: !widthCm || !depthCm,
  }
}

/** 회전한 서가를 감싸는 가로·세로 크기 */
export function extentOf({ width, depth, rotation }: Pick<ShelfShape, 'width' | 'depth' | 'rotation'>) {
  const radian = (rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(radian))
  const sin = Math.abs(Math.sin(radian))
  return { width: width * cos + depth * sin, height: width * sin + depth * cos }
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 서가가 적을 때 하나가 화면을 가득 채우지 않도록 하는 최소 지도 크기 */
const MIN_SPAN_CM = 200

export function boundsOf(shapes: readonly ShelfShape[]): Bounds {
  if (shapes.length === 0) return { minX: 0, minY: 0, maxX: MIN_SPAN_CM, maxY: MIN_SPAN_CM }
  const boxes = shapes.map((shape) => ({ ...shape, ...extentOf(shape) }))
  const span = (low: number, high: number): [number, number] => {
    const padding = Math.max(0, MIN_SPAN_CM - (high - low)) / 2
    return [low - padding, high + padding]
  }
  const [minX, maxX] = span(
    Math.min(...boxes.map((b) => b.cx - b.width / 2)),
    Math.max(...boxes.map((b) => b.cx + b.width / 2)),
  )
  const [minY, maxY] = span(
    Math.min(...boxes.map((b) => b.cy - b.height / 2)),
    Math.max(...boxes.map((b) => b.cy + b.height / 2)),
  )
  return { minX, minY, maxX, maxY }
}

export interface View {
  scale: number
  x: number
  y: number
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/** 아래 여백은 요약 카드와 확대 버튼이 놓이는 자리다. 낮은 화면의 맞춤에서는 높이의 30%까지만 비운다. */
export const MAP_INSETS = { top: 16, right: 16, bottom: 124, left: 16 }
const MAX_BOTTOM_RATIO = 0.3
/** 맞춤 배율의 몇 배까지 확대할 수 있는가. 맞춤보다 작게는 줄이지 않는다. */
export const MAX_ZOOM = 5

function usableArea({ width, height }: Size, bottom = Math.min(MAP_INSETS.bottom, height * MAX_BOTTOM_RATIO)) {
  return {
    left: MAP_INSETS.left,
    top: MAP_INSETS.top,
    width: Math.max(1, width - MAP_INSETS.left - MAP_INSETS.right),
    height: Math.max(1, height - MAP_INSETS.top - bottom),
  }
}

export function areaCenter(size: Size): Point {
  const area = usableArea(size)
  return { x: area.left + area.width / 2, y: area.top + area.height / 2 }
}

export function fitView(bounds: Bounds, size: Size): View {
  const area = usableArea(size)
  const scale = Math.min(area.width / (bounds.maxX - bounds.minX), area.height / (bounds.maxY - bounds.minY))
  const center = areaCenter(size)
  return {
    scale,
    x: center.x - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: center.y - ((bounds.minY + bounds.maxY) / 2) * scale,
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** 배율을 허용 범위에 두고, 보이는 영역의 중심이 지도 밖으로 나가지 않게 한다(지도를 잃어버리지 않는다). */
export function clampView(view: View, bounds: Bounds, size: Size): View {
  const min = fitView(bounds, size).scale
  const scale = clamp(view.scale, min, min * MAX_ZOOM)
  const center = areaCenter(size)
  const worldX = clamp((center.x - view.x) / view.scale, bounds.minX, bounds.maxX)
  const worldY = clamp((center.y - view.y) / view.scale, bounds.minY, bounds.maxY)
  const x = center.x - worldX * scale
  const y = center.y - worldY * scale
  const same = scale === view.scale && Math.abs(x - view.x) < 1e-6 && Math.abs(y - view.y) < 1e-6
  return same ? view : { scale, x, y }
}

/** 화면의 point 아래에 있는 지점을 고정한 채 확대·축소한다. */
export function zoomAt(view: View, point: Point, factor: number, bounds: Bounds, size: Size): View {
  const min = fitView(bounds, size).scale
  const scale = clamp(view.scale * factor, min, min * MAX_ZOOM)
  const ratio = scale / view.scale
  return clampView(
    { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio },
    bounds,
    size,
  )
}

export function panBy(view: View, dx: number, dy: number, bounds: Bounds, size: Size): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, bounds, size)
}

/** 지도 위에 겹쳐 서가를 가리는 것 */
export interface Covers {
  /** 요약 카드가 가리는 아래쪽 높이. 카드가 없으면 생략한다. */
  bottom?: number
  /** 확대 버튼의 왼쪽 위 지점. 그 오른쪽 아래를 가린다. */
  buttons?: Point
}

/** 가리는 것과 서가 사이에 두는 간격. 선택 테두리가 보일 만큼이다. */
const COVER_GAP = 8

/**
 * 서가가 보이는 영역을 벗어나거나 요약 카드·확대 버튼에 가리면 보이는 만큼만 옮긴다.
 * 옮길 필요가 없으면 같은 객체다.
 */
export function revealView(view: View, shape: ShelfShape, bounds: Bounds, size: Size, covers: Covers = {}): View {
  // 카드 높이를 모르면 낮은 화면에서도 기본 카드 자리를 모두 비운다.
  const area = usableArea(size, covers.bottom === undefined ? MAP_INSETS.bottom : covers.bottom + COVER_GAP)
  const extent = extentOf(shape)
  const width = extent.width * view.scale
  const height = extent.height * view.scale
  const cx = shape.cx * view.scale + view.x
  const cy = shape.cy * view.scale + view.y
  const place = (center: number, length: number, start: number, available: number) =>
    length > available ? start + available / 2 : clamp(center, start + length / 2, start + available - length / 2)
  let x = place(cx, width, area.left, area.width)
  let y = place(cy, height, area.top, area.height)

  if (covers.buttons) {
    // 버튼에 걸치면 왼쪽이나 위로 비킨다. 더 적게 옮기는 쪽을 고르고, 둘 다 자리가 없으면 그대로 둔다.
    const overX = x + width / 2 - (covers.buttons.x - COVER_GAP)
    const overY = y + height / 2 - (covers.buttons.y - COVER_GAP)
    if (overX > 0.5 && overY > 0.5) {
      const left = x - overX - width / 2 >= area.left ? overX : Infinity
      const up = y - overY - height / 2 >= area.top ? overY : Infinity
      if (left <= up && left !== Infinity) x -= left
      else if (up !== Infinity) y -= up
    }
  }

  const dx = x - cx
  const dy = y - cy
  return Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? view : panBy(view, dx, dy, bounds, size)
}
