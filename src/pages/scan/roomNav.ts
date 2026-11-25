// 자료실 드롭다운의 키보드 이동 규칙(순수 함수). 점검 진행 중(hasOpenSession) 항목은 선택할 수 없으므로 건너뛴다.

interface NavRoom {
  zone: string
  hasOpenSession: boolean
}

const isEnabled = (room: NavRoom | undefined) => room !== undefined && !room.hasOpenSession

export function firstEnabledIndex(rooms: readonly NavRoom[]): number {
  return rooms.findIndex(isEnabled)
}

export function lastEnabledIndex(rooms: readonly NavRoom[]): number {
  for (let i = rooms.length - 1; i >= 0; i--) if (isEnabled(rooms[i])) return i
  return -1
}

/** from에서 step(+1/-1) 방향으로 다음 선택 가능한 항목. 더 없으면 from을 그대로 돌려준다(순환하지 않는다). */
export function nextEnabledIndex(rooms: readonly NavRoom[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < rooms.length; i += step) if (isEnabled(rooms[i])) return i
  return from
}

/**
 * 열린 패널에서 활성으로 보여줄 항목. 현재 활성 항목이 아직 유효하면 유지하고,
 * 목록이 바뀌어 사라졌거나 선택할 수 없게 되었으면 선택된 자료실, 그것도 안 되면 첫 번째 선택 가능 항목으로 대체한다. 없으면 -1.
 */
export function resolveActiveIndex(rooms: readonly NavRoom[], active: number, selectedZone: string): number {
  if (isEnabled(rooms[active])) return active
  const selected = rooms.findIndex((room) => room.zone === selectedZone)
  return isEnabled(rooms[selected]) ? selected : firstEnabledIndex(rooms)
}
