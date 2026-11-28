import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  MAX_ZOOM,
  areaCenter,
  boundsOf,
  clampView,
  extentOf,
  fitView,
  panBy,
  revealView,
  zoomAt,
  type Covers,
  type ShelfShape,
  type Size,
  type View,
} from './mapGeometry'
import type { ShelfInspection, ShelfMapEntry, ShelfMarker } from './shelfMapModel'
import { useMapGestures } from './useMapGestures'

export interface PlacedShelf {
  entry: ShelfMapEntry
  shape: ShelfShape
  /** 읽어 주는 이름 */
  label: string
}

/** 화면 크기를 재기 전에 쓰는 값 (390px 폭 기준) */
const INITIAL_SIZE: Size = { width: 358, height: 520 }
const ZOOM_STEP = 1.4
const MARK = 12
const GAP = 3
const PAD = 6

const STATE_LABEL: Partial<Record<ShelfInspection, string>> = {
  waiting: '수신 대기',
  noObservation: '관측 0건',
}

interface ShelfMapCanvasProps {
  shelves: readonly PlacedShelf[]
  selectedId: number | null
  onSelect: (shelfId: number | null) => void
  /** 지도 아래에 겹치는 내용(선택한 서가의 요약). 확대 버튼은 그 위에 놓인다. */
  children?: ReactNode
}

/** SVG 배치도. 확대해도 서가 코드와 표시의 크기가 같도록 지도 좌표를 화면 좌표로 바꿔 그린다. */
export default function ShelfMapCanvas({ shelves, selectedId, onSelect, children }: ShelfMapCanvasProps) {
  const ref = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(INITIAL_SIZE)
  // null이면 맞춤 상태다. 화면 크기가 바뀌면 다시 맞춘다.
  const [userView, setUserView] = useState<View | null>(null)
  const idBase = useId()

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element
      if (width > 0 && height > 0) {
        setSize((old) => (old.width === width && old.height === height ? old : { width, height }))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bounds = boundsOf(shelves.map((s) => s.shape))
  const fit = fitView(bounds, size)
  const view = userView ? clampView(userView, bounds, size) : fit

  const update = (change: (current: View) => View) =>
    setUserView((old) => {
      const current = old ? clampView(old, bounds, size) : fit
      const next = change(current)
      return next === current ? old : next
    })

  const gestures = useMapGestures(ref, {
    onPan: (dx, dy) => update((v) => panBy(v, dx, dy, bounds, size)),
    onZoom: (point, factor, dx = 0, dy = 0) =>
      update((v) => panBy(zoomAt(v, point, factor, bounds, size), dx, dy, bounds, size)),
  })

  /** 지금 지도를 가리는 요약 카드와 확대 버튼의 위치 */
  const measureCovers = (): Covers => {
    const surface = ref.current?.getBoundingClientRect()
    const buttons = zoomRef.current?.getBoundingClientRect()
    const card = summaryRef.current?.getBoundingClientRect()
    if (!surface || !buttons) return {}
    return {
      bottom: card && card.height > 0 ? surface.bottom - card.top : undefined,
      buttons: { x: buttons.left - surface.left, y: buttons.top - surface.top },
    }
  }
  const reveal = (shelfId: number) => {
    const target = shelves.find((s) => s.entry.shelfId === shelfId)
    if (!target) return
    const covers = measureCovers()
    update((v) => revealView(v, target.shape, bounds, size, covers))
  }
  const revealRef = useRef(reveal)
  useLayoutEffect(() => {
    revealRef.current = reveal
  })

  // 요약 카드는 선택한 뒤에 그려지고 내용에 따라 높이가 달라진다. 선택, 카드 높이, 지도 크기가 바뀔 때마다
  // 선택한 서가가 가리지 않게 옮긴다. 사용자가 지도를 옮기거나 확대한 것만으로는 되돌리지 않는다.
  useEffect(() => {
    const summary = summaryRef.current
    if (selectedId === null || !summary) return
    // 관찰을 시작할 때도 한 번 불린다.
    const observer = new ResizeObserver(() => revealRef.current(selectedId))
    observer.observe(summary)
    return () => observer.disconnect()
  }, [selectedId, size])

  const select = (shelfId: number | null) => {
    onSelect(shelfId)
    // 새로 고른 서가는 카드가 그려진 뒤에 옮긴다. 이미 고른 서가를 다시 누르면 바로 옮긴다.
    if (shelfId !== null && shelfId === selectedId) reveal(shelfId)
  }
  const handleKey = (event: KeyboardEvent, shelfId: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(shelfId)
    } else if (event.key === 'Escape') onSelect(null)
  }
  const zoomBy = (factor: number) => update((v) => zoomAt(v, areaCenter(size), factor, bounds, size))

  return (
    <>
      <div
        ref={ref}
        className="shelf-map-surface"
        {...gestures.handlers}
        onClick={(event) => {
          if (gestures.consumeDrag()) return
          const id = (event.target as Element).closest('[data-shelf-id]')?.getAttribute('data-shelf-id')
          select(id ? Number(id) : null)
        }}
      >
        <svg
          className="shelf-map-svg"
          width={size.width}
          height={size.height}
          role="group"
          aria-label="서가 배치도"
          data-scale={view.scale.toFixed(4)}
        >
          <defs>
            <linearGradient id={`${idBase}-wood`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f1dfc3" />
              <stop offset="1" stopColor="#e4c8a2" />
            </linearGradient>
            <linearGradient id={`${idBase}-picked`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f9efdf" />
              <stop offset="1" stopColor="#efdcbf" />
            </linearGradient>
          </defs>
          {shelves.map(({ entry, shape, label }) => {
            const selected = entry.shelfId === selectedId
            const inactive = entry.inspection === 'notTargeted'
            const extent = extentOf(shape)
            const width = shape.width * view.scale
            const depth = shape.depth * view.scale
            const classes = [
              'shelf-node',
              selected && 'shelf-node--selected',
              inactive && 'shelf-node--inactive',
              shape.sizeUnknown && 'shelf-node--unsized',
            ]
            const fill = inactive ? undefined : `url(#${idBase}-${selected ? 'picked' : 'wood'})`
            return (
              <g
                key={entry.shelfId}
                className={classes.filter(Boolean).join(' ')}
                data-shelf-id={entry.shelfId}
                data-markers={entry.markers.join(' ')}
                transform={`translate(${shape.cx * view.scale + view.x} ${shape.cy * view.scale + view.y})`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={label}
                onKeyDown={(event) => handleKey(event, entry.shelfId)}
                onFocus={(event) => {
                  // 눌러서 생긴 포커스에는 지도를 옮기지 않는다.
                  if (event.currentTarget.matches(':focus-visible')) reveal(entry.shelfId)
                }}
              >
                <g transform={`rotate(${shape.rotation})`}>
                  {selected && (
                    <rect className="shelf-ring" x={-width / 2 - 4} y={-depth / 2 - 4} width={width + 8} height={depth + 8} rx={9} />
                  )}
                  <rect className="shelf-box" x={-width / 2} y={-depth / 2} width={width} height={depth} rx={6} fill={fill} />
                </g>
                <ShelfLabel
                  code={entry.shelfCode}
                  state={STATE_LABEL[entry.inspection]}
                  markers={entry.markers}
                  width={extent.width * view.scale}
                  height={extent.height * view.scale}
                />
              </g>
            )
          })}
        </svg>
      </div>

      <div className="shelf-map-overlay">
        <div ref={zoomRef} className="shelf-map-zoom" role="group" aria-label="지도 확대·축소">
          <button type="button" aria-label="확대" disabled={view.scale >= fit.scale * MAX_ZOOM - 1e-6} onClick={() => zoomBy(ZOOM_STEP)}>
            +
          </button>
          <button type="button" aria-label="축소" disabled={view.scale <= fit.scale + 1e-6} onClick={() => zoomBy(1 / ZOOM_STEP)}>
            −
          </button>
          <button
            type="button"
            aria-label="전체 보기"
            onClick={() => {
              setUserView(null)
              if (selectedId !== null) reveal(selectedId)
            }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2 2h4v4H2zM10 2h4v4h-4zM2 10h4v4H2zM10 10h4v4h-4z" />
            </svg>
          </button>
        </div>
        <div ref={summaryRef} className="shelf-map-summary">
          {children}
        </div>
      </div>
    </>
  )
}

/** 서가 코드, 상태 글, 색 표시. 서가를 돌려도 글과 표시는 바로 선다. */
function ShelfLabel({
  code,
  state,
  markers,
  width,
  height,
}: {
  code: string
  state: string | undefined
  markers: readonly ShelfMarker[]
  width: number
  height: number
}) {
  // 가로로 긴 서가는 코드를 왼쪽, 표시를 오른쪽에 둔다. 그 밖에는 코드를 가운데, 표시를 오른쪽 위에 둔다.
  const wide = width > height * 1.8
  const fontSize = Math.max(10, Math.min(15, Math.floor((width - 8) / (code.length * 0.65))))
  const codeWidth = code.length * fontSize * 0.65
  const space = wide ? width - 10 - codeWidth - PAD * 2 : width - PAD * 2
  const columns = Math.max(1, Math.min(markers.length, Math.floor((space + GAP) / (MARK + GAP))))
  const rows = Math.ceil(markers.length / columns)
  const top = wide ? -(rows * MARK + (rows - 1) * GAP) / 2 : -height / 2 + PAD

  return (
    <g className="shelf-label">
      <text className="shelf-code" x={wide ? -width / 2 + 10 : 0} textAnchor={wide ? 'start' : 'middle'} dy="0.35em" fontSize={fontSize}>
        {code}
      </text>
      {state &&
        (wide ? (
          markers.length === 0 &&
          space >= 44 && (
            <text className="shelf-state" x={width / 2 - PAD} textAnchor="end" dy="0.35em">
              {state}
            </text>
          )
        ) : (
          <text className="shelf-state" y={fontSize + 3} textAnchor="middle" dy="0.35em">
            {state}
          </text>
        ))}
      {markers.map((marker, index) => (
        <rect
          key={marker}
          className={`shelf-mark shelf-mark--${marker}`}
          x={width / 2 - PAD - MARK - (columns - 1 - (index % columns)) * (MARK + GAP)}
          y={top + Math.floor(index / columns) * (MARK + GAP)}
          width={MARK}
          height={MARK}
          rx={2}
        />
      ))}
    </g>
  )
}
