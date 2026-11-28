import { describe, expect, it } from 'vitest'
import {
  MAP_INSETS,
  MAX_ZOOM,
  areaCenter,
  boundsOf,
  extentOf,
  fitView,
  panBy,
  revealView,
  shelfShape,
  zoomAt,
  type ShelfShape,
  type View,
} from './mapGeometry'

const size = { width: 360, height: 500 }
const shape = (cx: number, cy: number, width = 90, depth = 30, rotation = 0): ShelfShape => ({
  cx,
  cy,
  width,
  depth,
  rotation,
  sizeUnknown: false,
})
const shapes = [shape(60, 60, 90, 90), shape(200, 40), shape(400, 600, 90, 30, 90)]
const bounds = boundsOf(shapes)
const fit = fitView(bounds, size)

/** 화면에 그려지는 서가의 네 변 */
const screenBox = (view: View, s: ShelfShape) => {
  const { width, height } = extentOf(s)
  const cx = s.cx * view.scale + view.x
  const cy = s.cy * view.scale + view.y
  const halfW = (width * view.scale) / 2
  const halfH = (height * view.scale) / 2
  return { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH }
}
const visible = (view: View, s: ShelfShape) => {
  const box = screenBox(view, s)
  return (
    box.left >= MAP_INSETS.left - 0.01 &&
    box.right <= size.width - MAP_INSETS.right + 0.01 &&
    box.top >= MAP_INSETS.top - 0.01 &&
    box.bottom <= size.height - MAP_INSETS.bottom + 0.01
  )
}

describe('서가 좌표 해석', () => {
  const base = { mapX: 10, mapY: 20, widthCm: 90, depthCm: 40, rotationDegree: 90 }

  it.each([{ mapX: null }, { mapY: null }])('좌표가 하나라도 없으면 지도에 놓지 않는다: %o', (missing) => {
    expect(shelfShape({ ...base, ...missing })).toBeNull()
  })

  it('좌표 0은 유효하고, 크기가 없거나 0이면 기본 크기로 놓고 알린다. 회전이 없으면 0이다', () => {
    expect(shelfShape(base)).toEqual({ cx: 10, cy: 20, width: 90, depth: 40, rotation: 90, sizeUnknown: false })
    expect(shelfShape({ mapX: 0, mapY: 0, widthCm: null, depthCm: 0, rotationDegree: null })).toEqual({
      cx: 0,
      cy: 0,
      width: 90,
      depth: 30,
      rotation: 0,
      sizeUnknown: true,
    })
  })

  it('90도 돌린 서가는 가로와 세로가 바뀐다', () => {
    const { width, height } = extentOf(shape(0, 0, 90, 30, 90))
    expect([Math.round(width), Math.round(height)]).toEqual([30, 90])
  })
})

describe('지도 보기', () => {
  it('맞춤 상태에서는 모든 서가가 요약 카드 자리를 뺀 영역에 보인다', () => {
    expect(shapes.every((s) => visible(fit, s))).toBe(true)
  })

  it('낮은 화면에서도 서가를 고르면 요약 카드 위로 올린다', () => {
    const low = { width: 330, height: 340 }
    const lowFit = fitView(bounds, low)
    for (const s of shapes) {
      const box = screenBox(revealView(lowFit, s, bounds, low), s)
      expect(box.bottom).toBeLessThanOrEqual(low.height - MAP_INSETS.bottom + 0.01)
      expect(box.top).toBeGreaterThanOrEqual(MAP_INSETS.top - 0.01)
    }
  })

  it('카드가 높으면 그 위로 올리고, 확대 버튼에 걸치면 비킨다', () => {
    const covers = { bottom: 160, buttons: { x: size.width - 46, y: size.height - 280 } }
    for (const s of shapes) {
      const view = revealView(fit, s, bounds, size, covers)
      const box = screenBox(view, s)
      expect(box.bottom).toBeLessThanOrEqual(size.height - covers.bottom)
      expect(box.right <= covers.buttons.x || box.bottom <= covers.buttons.y).toBe(true)
      // 한 번 옮긴 뒤에는 그대로다.
      expect(revealView(view, s, bounds, size, covers)).toBe(view)
    }
  })

  it('서가가 하나면 화면을 가득 채우지 않는다', () => {
    const one = shape(0, 0)
    const view = fitView(boundsOf([one]), size)
    expect(screenBox(view, one).right - screenBox(view, one).left).toBeLessThan(size.width / 2)
  })

  it('확대는 가리킨 지점을 고정하고, 맞춤의 1~5배를 벗어나지 않는다', () => {
    const point = { x: 120, y: 150 }
    const zoomed = zoomAt(fit, point, 2, bounds, size)
    expect(zoomed.scale).toBeCloseTo(fit.scale * 2)
    expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo((point.x - fit.x) / fit.scale)
    expect((point.y - zoomed.y) / zoomed.scale).toBeCloseTo((point.y - fit.y) / fit.scale)
    expect(zoomAt(fit, point, 100, bounds, size).scale).toBeCloseTo(fit.scale * MAX_ZOOM)
    expect(zoomAt(zoomed, point, 0.001, bounds, size).scale).toBeCloseTo(fit.scale)
  })

  it('아무리 끌어도 보이는 영역의 중심에는 지도가 남는다', () => {
    for (const [dx, dy] of [
      [10_000, 10_000],
      [-10_000, -10_000],
    ]) {
      const view = panBy(fit, dx, dy, bounds, size)
      const center = areaCenter(size)
      const world = { x: (center.x - view.x) / view.scale, y: (center.y - view.y) / view.scale }
      expect(world.x).toBeGreaterThanOrEqual(bounds.minX - 0.01)
      expect(world.x).toBeLessThanOrEqual(bounds.maxX + 0.01)
      expect(world.y).toBeGreaterThanOrEqual(bounds.minY - 0.01)
      expect(world.y).toBeLessThanOrEqual(bounds.maxY + 0.01)
    }
  })

  it('가려진 서가만 보이는 영역으로 옮기고, 이미 보이면 그대로 둔다', () => {
    expect(revealView(fit, shapes[0], bounds, size)).toBe(fit)
    const zoomed = zoomAt(fit, areaCenter(size), 2.5, bounds, size)
    for (const s of shapes) {
      expect(visible(revealView(zoomed, s, bounds, size), s)).toBe(true)
    }
  })
})
