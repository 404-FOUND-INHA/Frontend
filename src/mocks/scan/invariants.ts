import { OPEN_STATUSES } from './store'
import type { MockData } from './types'

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/** Mock 데이터가 Backend 규칙과 어긋난 지점을 문자열로 돌려준다. 비어 있으면 정합성이 유지된 것이다. (테스트에서 사용) */
export function findInvariantViolations(data: MockData): string[] {
  const violations: string[] = []
  const shelvesById = new Map(data.shelves.map((s) => [s.id, s]))
  const sessionsById = new Map(data.sessions.map((s) => [s.id, s]))

  if (shelvesById.size !== data.shelves.length) violations.push('서가 ID가 중복됨')
  if (sessionsById.size !== data.sessions.length) violations.push('회차 ID가 중복됨')

  const openCountByZone = new Map<string, number>()
  for (const session of data.sessions) {
    if (OPEN_STATUSES.includes(session.status) && session.zone !== null) {
      openCountByZone.set(session.zone, (openCountByZone.get(session.zone) ?? 0) + 1)
    }
    if (session.startedAt === null || !DATE_TIME.test(session.startedAt)) {
      violations.push(`회차 ${session.id}: startedAt 형식 오류`)
    }
    if (!DATE_TIME.test(session.createdAt)) violations.push(`회차 ${session.id}: createdAt 형식 오류`)
    if ((session.finalizedAt !== null) !== (session.status === 'COMPLETED')) {
      violations.push(`회차 ${session.id}: finalizedAt은 COMPLETED에만 있어야 함`)
    }

    const registered = data.sessionShelves.filter((ss) => ss.sessionId === session.id)
    if (registered.length === 0) violations.push(`회차 ${session.id}: 대상 서가가 없음`)
    const expectedScanStatus = session.status === 'IN_PROGRESS' ? 'WAITING' : 'RESULT_RECEIVED'
    for (const ss of registered) {
      const shelf = shelvesById.get(ss.shelfId)
      if (!shelf) violations.push(`회차 ${session.id}: 존재하지 않는 서가 ${ss.shelfId}`)
      else if (shelf.zone !== session.zone) violations.push(`회차 ${session.id}: 다른 자료실의 서가 ${ss.shelfId}`)
      if (ss.scanStatus !== expectedScanStatus) {
        violations.push(`회차 ${session.id}: ${session.status}인데 서가 ${ss.shelfId}가 ${ss.scanStatus}`)
      }
    }
  }
  for (const [zone, count] of openCountByZone) {
    if (count > 1) violations.push(`자료실 ${zone}: 미완료 회차가 ${count}개`)
  }

  const pairs = new Set<string>()
  for (const ss of data.sessionShelves) {
    const key = `${ss.sessionId}:${ss.shelfId}`
    if (pairs.has(key)) violations.push(`회차-서가 관계가 중복됨: ${key}`)
    pairs.add(key)
    if (!sessionsById.has(ss.sessionId)) violations.push(`존재하지 않는 회차 ${ss.sessionId}의 서가 관계`)
  }
  return violations
}
