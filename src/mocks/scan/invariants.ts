import type { ObservationStatusReason } from '@/types/scan/analysis'
import { OPEN_STATUSES } from './store'
import type { MockBook, MockData, MockObservation } from './types'

/** 타임존 없는 ISO 날짜시간(Backend LocalDateTime). 소수 초는 DB 정밀도인 마이크로초(6자리)까지다. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/
const MAX_CANDIDATES = 3

/** 도서를 식별하지 못한 사유. 그 외(정상 포함)는 식별한 도서와 신뢰도가 있어야 한다. */
const UNIDENTIFIED_REASONS: readonly ObservationStatusReason[] = ['OCR_FAILED', 'NO_MATCH', 'AMBIGUOUS_MATCH']

/**
 * 저장 데이터 자체가 Backend 규칙과 어긋난 지점을 문자열로 돌려준다. 비어 있으면 정합성이 유지된 것이다. (테스트에서 사용)
 * 분석 결과는 분석 시점의 판정이므로 현재 도서 원장(예상 서가, lifecycleStatus)으로 다시 판정하지 않는다.
 * 원장 기준의 판정 검증은 findJudgementViolations가 맡는다.
 */
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
  return [...violations, ...findObservationViolations(data)]
}

/** 도서와 관측(자동 분석 결과)의 참조 관계와 저장된 판정의 일관성 */
function findObservationViolations(data: MockData): string[] {
  const violations: string[] = []
  const shelfIds = new Set(data.shelves.map((s) => s.id))
  const booksById = new Map(data.books.map((b) => [b.id, b]))
  const links = new Map(data.sessionShelves.map((ss) => [`${ss.sessionId}:${ss.shelfId}`, ss]))

  if (booksById.size !== data.books.length) violations.push('도서 ID가 중복됨')
  if (new Set(data.observations.map((o) => o.id)).size !== data.observations.length) violations.push('관측 ID가 중복됨')
  for (const book of data.books) {
    if (book.expectedShelfId !== null && !shelfIds.has(book.expectedShelfId)) {
      violations.push(`도서 ${book.id}: 존재하지 않는 예상 서가 ${book.expectedShelfId}`)
    }
  }

  const orders = new Set<string>()
  const receivedAtBySession = new Map<number, string>()
  for (const o of data.observations) {
    const report = (message: string) => violations.push(`관측 ${o.id}: ${message}`)

    const link = links.get(`${o.sessionId}:${o.shelfId}`)
    if (!link) report('회차의 대상 서가가 아님')
    else if (link.scanStatus !== 'RESULT_RECEIVED') report('수신 전 서가에는 관측이 있을 수 없음')

    const orderKey = `${o.sessionId}:${o.shelfId}:${o.detectedOrder}`
    if (!Number.isInteger(o.detectedOrder) || o.detectedOrder < 1) report('detectedOrder는 1 이상의 정수여야 함')
    if (orders.has(orderKey)) report('같은 서가에 detectedOrder가 중복됨')
    orders.add(orderKey)

    if (!DATE_TIME.test(o.receivedAt)) report('receivedAt 형식 오류')
    if (o.detectedAt !== null && !DATE_TIME.test(o.detectedAt)) report('detectedAt 형식 오류')
    const receivedAt = receivedAtBySession.get(o.sessionId)
    if (receivedAt === undefined) receivedAtBySession.set(o.sessionId, o.receivedAt)
    else if (receivedAt !== o.receivedAt) report('같은 회차의 관측은 receivedAt이 같아야 함')

    const expectedStatus =
      o.statusReason === null ? 'NORMAL' : o.statusReason === 'WRONG_SHELF' ? 'MISPLACED' : 'REVIEW_REQUIRED'
    if (o.analysisStatus !== expectedStatus) report(`상태 ${o.analysisStatus}와 사유 ${o.statusReason}가 맞지 않음`)

    const identified = o.statusReason === null || !UNIDENTIFIED_REASONS.includes(o.statusReason)
    if (identified !== (o.bookId !== null)) report(`사유 ${o.statusReason}와 식별 도서 유무가 맞지 않음`)
    if ((o.bookId !== null) !== (o.matchConfidence !== null)) report('신뢰도는 식별한 도서가 있을 때만 있어야 함')
    if (o.matchConfidence !== null && !(o.matchConfidence > 0 && o.matchConfidence <= 1)) {
      report('신뢰도는 0 초과 1 이하여야 함')
    }
    const hasParsed = [o.detectedClassificationNo, o.detectedBookSymbol, o.detectedCopyNumber].some((v) => v !== null)
    if (o.statusReason === 'OCR_FAILED' && hasParsed) report('인식 실패 관측에는 파싱값이 없어야 함')

    if (o.bookId !== null && !booksById.has(o.bookId)) report(`존재하지 않는 도서 ${o.bookId}`)
    checkCandidates(o, booksById, report)
  }
  return [...violations, ...findDuplicateViolations(data)]
}

/** '회차:도서' → 그 회차에서 그 도서로 식별된 관측들 */
function groupBySessionBook(observations: readonly MockObservation[]): Map<string, MockObservation[]> {
  const groups = new Map<string, MockObservation[]>()
  for (const o of observations) {
    if (o.bookId === null) continue
    const key = `${o.sessionId}:${o.bookId}`
    const group = groups.get(key)
    if (group) group.push(o)
    else groups.set(key, [o])
  }
  return groups
}

/**
 * 중복 판정은 원장 없이 관측만으로 확인할 수 있다. 한 회차에서 같은 도서가 2건 이상이면 모두 중복이거나
 * 모두 제적(제적은 중복보다 우선한다)이고, 1건뿐이면 중복일 수 없다.
 */
function findDuplicateViolations(data: MockData): string[] {
  const violations: string[] = []
  for (const [key, group] of groupBySessionBook(data.observations)) {
    const reasons = new Set(group.map((o) => o.statusReason))
    if (group.length === 1) {
      if (reasons.has('DUPLICATE_OBSERVATION')) violations.push(`관측 ${group[0].id}: 같은 도서의 관측이 1건뿐인데 중복 판정`)
    } else if (reasons.size !== 1 || !(reasons.has('DUPLICATE_OBSERVATION') || reasons.has('DISPOSED_BOOK'))) {
      violations.push(`회차:도서 ${key}: 같은 도서의 관측 ${group.length}건은 모두 중복이거나 모두 제적이어야 함`)
    }
  }
  return violations
}

/**
 * data.books가 분석 당시의 원장이라는 전제에서, 도서를 식별한 관측의 사유가 판정 우선순위대로인지 확인한다.
 * 갓 만든 시드나 테스트 데이터에만 사용한다. 이후에 원장이 바뀐 데이터에 어긋남이 생기는 것은 정상이다.
 */
export function findJudgementViolations(data: MockData): string[] {
  const booksById = new Map(data.books.map((b) => [b.id, b]))
  const violations: string[] = []
  for (const group of groupBySessionBook(data.observations).values()) {
    for (const o of group) {
      const book = booksById.get(o.bookId as number)
      if (!book) continue // 참조 오류는 findInvariantViolations가 알린다.
      const expected = identifiedReason(o, book, group.length)
      if (o.statusReason !== expected) {
        violations.push(`관측 ${o.id}: 판정 사유는 ${expected}여야 함 (현재 ${o.statusReason})`)
      }
    }
  }
  return violations
}

/** 도서를 식별한 관측의 사유. 우선순위: 제적 > 중복 > 예상 서가 없음 > 서가 비교 */
function identifiedReason(o: MockObservation, book: MockBook, observedCount: number): ObservationStatusReason | null {
  if (book.lifecycleStatus === 'DISPOSED') return 'DISPOSED_BOOK'
  if (observedCount > 1) return 'DUPLICATE_OBSERVATION'
  if (book.expectedShelfId === null) return 'NO_EXPECTED_SHELF'
  return book.expectedShelfId === o.shelfId ? null : 'WRONG_SHELF'
}

/** 후보는 NO_MATCH(0~3건, 완전 일치 제외)와 AMBIGUOUS_MATCH(2~3건, 모두 완전 일치)에만 있다. */
function checkCandidates(o: MockObservation, booksById: Map<number, MockBook>, report: (message: string) => void): void {
  const { candidates, statusReason } = o
  if (statusReason === 'AMBIGUOUS_MATCH') {
    if (candidates.length < 2) report('복수 후보 관측은 후보가 2건 이상이어야 함')
    if (candidates.some((c) => c.reason !== 'EXACT_MATCH')) report('복수 후보의 근거는 완전 일치여야 함')
  } else if (statusReason === 'NO_MATCH') {
    if (candidates.some((c) => c.reason === 'EXACT_MATCH')) report('일치 도서 없음의 후보에는 완전 일치가 없어야 함')
  } else if (candidates.length > 0) {
    report(`사유 ${statusReason}에는 후보가 없어야 함`)
  }
  if (candidates.length > MAX_CANDIDATES) report(`후보는 최대 ${MAX_CANDIDATES}건임`)

  const ranks = candidates.map((c) => c.rank).sort((a, b) => a - b)
  if (ranks.some((rank, index) => rank !== index + 1)) report('후보 순위는 1부터 연속이어야 함')
  if (new Set(candidates.map((c) => c.bookId)).size !== candidates.length) report('후보 도서가 중복됨')
  for (const c of candidates) {
    if (!booksById.has(c.bookId)) report(`존재하지 않는 후보 도서 ${c.bookId}`)
  }
}
