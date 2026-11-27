import type { ObservationStatusReason } from '@/types/scan/analysis'
import { timeKey } from './localDateTime'
import { OPEN_STATUSES } from './store'
import type { MockBook, MockData, MockObservation, MockReview } from './types'

const MAX_CANDIDATES = 3
const MAX_COMMENT_LENGTH = 1000

/** 도서를 식별하지 못한 사유. 그 외(정상 포함)는 식별한 도서와 신뢰도가 있어야 한다. */
const UNIDENTIFIED_REASONS: readonly ObservationStatusReason[] = ['OCR_FAILED', 'NO_MATCH', 'AMBIGUOUS_MATCH']

/**
 * 저장 데이터 자체가 Backend 규칙과 어긋난 지점을 문자열로 돌려준다. 비어 있으면 정합성이 유지된 것이다. (테스트에서 사용)
 * 분석 결과와 검토 결과는 그 시점의 판정이므로 현재 도서 원장(예상 서가, lifecycleStatus)으로 다시 판정하지 않는다.
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
    if (session.startedAt === null || timeKey(session.startedAt) === null) {
      violations.push(`회차 ${session.id}: startedAt 형식 오류`)
    }
    if (timeKey(session.createdAt) === null) violations.push(`회차 ${session.id}: createdAt 형식 오류`)
    if (session.finalizedAt !== null && timeKey(session.finalizedAt) === null) {
      violations.push(`회차 ${session.id}: finalizedAt 형식 오류`)
    }
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
  return [
    ...violations,
    ...findObservationViolations(data),
    ...findReviewViolations(data),
    ...findFinalizationViolations(data),
  ]
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
    if (book.currentShelfId !== null && !shelfIds.has(book.currentShelfId)) {
      violations.push(`도서 ${book.id}: 존재하지 않는 확인 서가 ${book.currentShelfId}`)
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

    if (o.detectedAt !== null && timeKey(o.detectedAt) === null) report('detectedAt 형식 오류')
    const receivedAt = timeKey(o.receivedAt)
    if (receivedAt === null) report('receivedAt 형식 오류')
    else {
      const first = receivedAtBySession.get(o.sessionId)
      if (first === undefined) receivedAtBySession.set(o.sessionId, receivedAt)
      else if (first !== receivedAt) report('같은 회차의 관측은 receivedAt이 같아야 함')
    }

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

/** 자동 분석이 도서와 서가를 확정한 상태. 이 관측의 도서는 검토에서 다시 지정할 수 없다. */
const RESOLVED_STATUSES: readonly string[] = ['NORMAL', 'MISPLACED']

/** 사서 검토 기록의 참조 관계와 Backend 검토 규칙(ReviewService) */
function findReviewViolations(data: MockData): string[] {
  const violations: string[] = []
  const observationsById = new Map(data.observations.map((o) => [o.id, o]))
  const sessionsById = new Map(data.sessions.map((s) => [s.id, s]))
  const bookIds = new Set(data.books.map((b) => b.id))
  const userIds = new Set(data.users.map((u) => u.id))

  if (userIds.size !== data.users.length) violations.push('사용자 ID가 중복됨')
  if (new Set(data.reviews.map((r) => r.id)).size !== data.reviews.length) violations.push('검토 ID가 중복됨')

  /** '회차:도서' → 이미 그 회차에서 그 도서를 확정한 근거가 있음. 자동 분석이 확정한 관측부터 채운다. */
  const assigned = new Set(
    data.observations
      .filter((o) => o.bookId !== null && RESOLVED_STATUSES.includes(o.analysisStatus))
      .map((o) => `${o.sessionId}:${o.bookId}`),
  )
  const reviewedObservations = new Set<number>()
  for (const review of data.reviews) {
    const report = (message: string) => violations.push(`검토 ${review.id}: ${message}`)

    if (reviewedObservations.has(review.observationId)) report('같은 관측에 검토가 중복됨')
    reviewedObservations.add(review.observationId)
    if (!userIds.has(review.reviewerId)) report(`존재하지 않는 검토자 ${review.reviewerId}`)
    checkReviewDecision(review, report)
    if (review.comment !== null && (review.comment !== review.comment.trim() || review.comment === '' || review.comment.length > MAX_COMMENT_LENGTH)) {
      report('의견은 null이거나 앞뒤 공백 없는 1000자 이하 문자열이어야 함')
    }
    const reviewedAt = timeKey(review.reviewedAt)
    if (reviewedAt === null) report('reviewedAt 형식 오류')

    const observation = observationsById.get(review.observationId)
    if (!observation) {
      report(`존재하지 않는 관측 ${review.observationId}`)
      continue
    }
    if (observation.analysisStatus !== 'REVIEW_REQUIRED') report('검토 필요 관측이 아님')
    // 형식이 잘못된 시각은 위에서(또는 해당 관측·회차에서) 알리므로 전후 비교에서 제외한다.
    const receivedAt = timeKey(observation.receivedAt)
    if (reviewedAt !== null && receivedAt !== null && reviewedAt < receivedAt) report('결과 수신 전에 검토할 수 없음')
    const session = sessionsById.get(observation.sessionId)
    if (session?.status === 'IN_PROGRESS') report('수신 전 회차에는 검토가 있을 수 없음')
    const finalizedAt = session?.finalizedAt ? timeKey(session.finalizedAt) : null
    if (reviewedAt !== null && finalizedAt !== null && reviewedAt > finalizedAt) report('확정 이후에 검토할 수 없음')

    if (review.finalBookId === null) continue
    if (!bookIds.has(review.finalBookId)) report(`존재하지 않는 도서 ${review.finalBookId}`)
    const key = `${observation.sessionId}:${review.finalBookId}`
    if (assigned.has(key)) report(`같은 회차에서 이미 확정된 도서 ${review.finalBookId}`)
    assigned.add(key)
  }

  // 확정된 회차에는 미처리 필수 검토가 없다.
  for (const o of data.observations) {
    if (o.analysisStatus !== 'REVIEW_REQUIRED' || reviewedObservations.has(o.id)) continue
    if (sessionsById.get(o.sessionId)?.status === 'COMPLETED') {
      violations.push(`회차 ${o.sessionId}: 확정된 회차에 미검토 관측이 있음 (관측 ${o.id})`)
    }
  }
  return violations
}

/** 확정 정보(확정자, 확정 시각)와 소재불명 후보의 참조 관계 */
function findFinalizationViolations(data: MockData): string[] {
  const violations: string[] = []
  const sessionsById = new Map(data.sessions.map((s) => [s.id, s]))
  const userIds = new Set(data.users.map((u) => u.id))
  const bookIds = new Set(data.books.map((b) => b.id))

  for (const session of data.sessions) {
    const report = (message: string) => violations.push(`회차 ${session.id}: ${message}`)
    if ((session.finalizedBy !== null) !== (session.status === 'COMPLETED')) report('finalizedBy는 COMPLETED에만 있어야 함')
    if (session.finalizedBy !== null && !userIds.has(session.finalizedBy)) report(`존재하지 않는 확정자 ${session.finalizedBy}`)
    const finalizedAt = session.finalizedAt === null ? null : timeKey(session.finalizedAt)
    if (finalizedAt === null) continue
    // 형식이 잘못된 시각은 findInvariantViolations가 알리므로 전후 비교에서 제외한다.
    const isAfterFinalization = (time: string | null) => time !== null && (timeKey(time) ?? '') > finalizedAt
    if (isAfterFinalization(session.createdAt)) report('생성 전에 확정할 수 없음')
    if (isAfterFinalization(session.startedAt)) report('시작 전에 확정할 수 없음')
    const receivedLater = data.observations.some(
      (o) => o.sessionId === session.id && (timeKey(o.receivedAt) ?? '') > finalizedAt,
    )
    if (receivedLater) report('결과 수신 전에 확정할 수 없음')
  }

  if (new Set(data.missingCandidates.map((c) => c.id)).size !== data.missingCandidates.length) {
    violations.push('후보 ID가 중복됨')
  }
  /** '회차:도서' → 그 회차에서 위치가 확인된 도서 */
  const found = new Set(
    data.observations
      .filter((o) => o.bookId !== null && RESOLVED_STATUSES.includes(o.analysisStatus))
      .map((o) => `${o.sessionId}:${o.bookId}`),
  )
  const observationsById = new Map(data.observations.map((o) => [o.id, o]))
  for (const review of data.reviews) {
    const observation = observationsById.get(review.observationId)
    if (observation && review.finalBookId !== null) found.add(`${observation.sessionId}:${review.finalBookId}`)
  }
  const receivedShelves = new Set(
    data.sessionShelves.filter((ss) => ss.scanStatus === 'RESULT_RECEIVED').map((ss) => `${ss.sessionId}:${ss.shelfId}`),
  )
  const pairs = new Set<string>()
  for (const candidate of data.missingCandidates) {
    const report = (message: string) => violations.push(`후보 ${candidate.id}: ${message}`)
    const key = `${candidate.sessionId}:${candidate.bookId}`
    if (pairs.has(key)) report('같은 회차에 도서의 후보가 중복됨')
    pairs.add(key)
    if (!bookIds.has(candidate.bookId)) report(`존재하지 않는 도서 ${candidate.bookId}`)
    if (found.has(key)) report(`이 회차에서 발견한 도서 ${candidate.bookId}`)
    if (!receivedShelves.has(`${candidate.sessionId}:${candidate.expectedShelfId}`)) {
      report('결과를 수신한 대상 서가의 도서가 아님')
    }
    const createdAt = timeKey(candidate.createdAt)
    if (createdAt === null) report('createdAt 형식 오류')
    const session = sessionsById.get(candidate.sessionId)
    const finalizedAt = session?.finalizedAt ? timeKey(session.finalizedAt) : null
    if (session?.status !== 'COMPLETED') report('확정한 회차에만 있어야 함')
    else if (createdAt !== null && finalizedAt !== null && createdAt !== finalizedAt) {
      report('createdAt은 회차의 확정 시각이어야 함')
    }
  }
  return violations
}

/** 조치, 확정 도서, 최종 판정의 조합 */
function checkReviewDecision(review: MockReview, report: (message: string) => void): void {
  const { action, finalStatus, finalBookId } = review
  const identified = action === 'IDENTIFY_BOOK'
  if (identified !== (finalBookId !== null)) report('도서는 도서 확정 조치에만, 그리고 반드시 있어야 함')
  const allowed =
    action === 'IDENTIFY_BOOK'
      ? finalStatus === 'NORMAL' || finalStatus === 'MISPLACED'
      : finalStatus === (action === 'MARK_UNIDENTIFIED' ? 'UNIDENTIFIED' : 'EXCLUDED')
  if (!allowed) report(`조치 ${action}와 판정 ${finalStatus}가 맞지 않음`)
}

/**
 * data.books가 분석·검토·후보 산출 당시의 원장이라는 전제에서, 도서를 식별한 관측의 사유가 판정 우선순위대로인지,
 * 도서를 확정한 검토의 판정이 예상 서가 비교와 맞는지, 소재불명 후보가 산출 기준에 맞는지 확인한다.
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
  const observationsById = new Map(data.observations.map((o) => [o.id, o]))
  for (const review of data.reviews) {
    const observation = observationsById.get(review.observationId)
    const book = review.finalBookId === null ? undefined : booksById.get(review.finalBookId)
    if (!observation || !book) continue
    // 예상 서가와 관측 서가가 같을 때만 NORMAL, 다르거나 예상 서가가 없으면 MISPLACED
    const expected = book.expectedShelfId === observation.shelfId ? 'NORMAL' : 'MISPLACED'
    if (review.finalStatus !== expected) {
      violations.push(`검토 ${review.id}: 최종 판정은 ${expected}여야 함 (현재 ${review.finalStatus})`)
    }
  }
  for (const candidate of data.missingCandidates) {
    const book = booksById.get(candidate.bookId)
    if (!book) continue
    const report = (message: string) => violations.push(`후보 ${candidate.id}: ${message}`)
    if (book.expectedShelfId !== candidate.expectedShelfId) report('도서의 예상 서가와 다름')
    if (book.lifecycleStatus === 'DISPOSED') report('제적 도서는 후보가 아님')
    if (book.loanStatus === 'ON_LOAN' || book.loanStatus === 'LOST') report('대출 중·분실 처리 도서는 후보가 아님')
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
