import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { Point } from './mapGeometry'

/** 이 거리(px) 안에서 떼면 이동이 아니라 누르기다. */
const TAP_SLOP = 6

export interface MapGestureActions {
  onPan: (dx: number, dy: number) => void
  /** point 기준으로 factor배 확대하고, 이어서 (dx, dy)만큼 옮긴다. */
  onZoom: (point: Point, factor: number, dx?: number, dy?: number) => void
}

/**
 * 지도의 한 손가락 이동, 두 손가락 확대, 휠 확대. 서가 선택은 click으로 처리하며,
 * 이동이나 확대를 한 직후의 click은 consumeDrag()가 true이므로 무시한다.
 */
export function useMapGestures(ref: RefObject<HTMLElement | null>, { onPan, onZoom }: MapGestureActions) {
  const pointers = useRef(new Map<number, Point>())
  const start = useRef<Point>({ x: 0, y: 0 })
  const dragged = useRef(false)

  const localPoint = (element: Element, event: { clientX: number; clientY: number }): Point => {
    const rect = element.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  // React의 wheel 이벤트는 passive라 페이지 스크롤·확대를 막을 수 없어 직접 등록한다.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      // 트랙패드의 두 손가락 확대는 ctrlKey가 있는 작은 값으로 온다.
      const speed = event.ctrlKey ? 0.01 : event.deltaMode === 1 ? 0.03 : 0.0015
      onZoom(localPoint(element, event), Math.exp(-event.deltaY * speed))
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  })

  const release = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId)
  }

  return {
    consumeDrag(): boolean {
      const result = dragged.current
      dragged.current = false
      return result
    },
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        // 첫 번째 포인터는 새 동작의 시작이다. 떼는 것을 받지 못한 이전 포인터는 버린다.
        if (event.isPrimary) {
          pointers.current.clear()
          dragged.current = false
        }
        const point = localPoint(event.currentTarget, event)
        pointers.current.set(event.pointerId, point)
        if (pointers.current.size === 1) start.current = point
        else {
          dragged.current = true
          for (const id of pointers.current.keys()) event.currentTarget.setPointerCapture(id)
        }
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const previous = pointers.current.get(event.pointerId)
        if (!previous) return
        // 지도 밖에서 마우스 버튼을 뗀 경우
        if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) return release(event)
        const next = localPoint(event.currentTarget, event)

        if (pointers.current.size === 1) {
          if (!dragged.current) {
            if (Math.hypot(next.x - start.current.x, next.y - start.current.y) <= TAP_SLOP) return
            dragged.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          pointers.current.set(event.pointerId, next)
          onPan(next.x - previous.x, next.y - previous.y)
          return
        }

        const pair = () => {
          const [a, b] = [...pointers.current.values()]
          return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) }
        }
        const before = pair()
        pointers.current.set(event.pointerId, next)
        const after = pair()
        if (before.distance === 0) return
        onZoom(before.mid, after.distance / before.distance, after.mid.x - before.mid.x, after.mid.y - before.mid.y)
      },
      onPointerUp: release,
      onPointerCancel: release,
    },
  }
}
