import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { MissingCandidateStatus } from '@/types/scan/missingCandidate'
import type { FinalizeResponse } from '@/types/scan/review'
import { timeKey } from './localDateTime'
import type { MockBook, MockData, MockLoanStatus, MockMissingCandidate, MockSession } from './types'

// 회차 확정 (Backend ScanFinalizationService, MissingCandidateGenerator의 후보 산출).
// planFinalization은 저장소를 읽기만 하고 바뀔 값을 새 객체로 만든다. 계산과 오류 검사는 모두 여기서 끝낸다.
// applyFinalization은 계산한 값을 넣기만 하므로 중간에 실패하지 않는다.
// 회차 존재, 상태, 미처리 검토 확인은 store.ts가 먼저 한다.

/** 점검에서 위치가 확인된 도서 → 관측 서가 */
export type Findings = ReadonlyMap<number, number>

/** 소재불명 후보에서 제외하는 대출 상태 */
const EXCLUDED_LOAN_STATUSES: readonly MockLoanStatus[] = ['ON_LOAN', 'LOST']

/** 연속 미발견 횟수를 이어 가지 않는 확인 상태: 도서를 찾았거나 종결한 후보 (Backend breaksStreak) */
const STREAK_BREAKING_STATUSES: readonly MissingCandidateStatus[] = ['FOUND', 'RESOLVED']

export interface FinalizationPlan {
  session: MockSession
  /** 위치를 확인해 원장에 반영할 도서의 새 값 */
  books: MockBook[]
  missingCandidates: MockMissingCandidate[]
  response: FinalizeResponse
}

/** 회차의 검토 기록 */
function reviewsOf(data: MockData, sessionId: number) {
  const observations = new Map(data.observations.filter((o) => o.sessionId === sessionId).map((o) => [o.id, o]))
  return data.reviews.flatMap((review) => {
    const observation = observations.get(review.observationId)
    return observation ? [{ review, observation }] : []
  })
}

/**
 * 자동 분석이 정상·오배치로 판정한 관측과 사서가 정상·오배치로 확정한 검토의 도서.
 * 같은 도서가 두 번 확정돼 있으면 어느 서가가 맞는지 알 수 없으므로 실패시킨다. (Backend는 500)
 */
export function collectFindings(data: MockData, sessionId: number): Findings {
  const resolved = (status: string) => status === 'NORMAL' || status === 'MISPLACED'
  const automatic = data.observations
    .filter((o) => o.sessionId === sessionId && resolved(o.analysisStatus))
    .map((o) => ({ bookId: o.bookId, shelfId: o.shelfId }))
  const reviewed = reviewsOf(data, sessionId)
    .filter(({ review }) => resolved(review.finalStatus))
    .map(({ review, observation }) => ({ bookId: review.finalBookId, shelfId: observation.shelfId }))

  const findings = new Map<number, number>()
  for (const { bookId, shelfId } of [...automatic, ...reviewed]) {
    if (bookId === null) continue
    if (findings.has(bookId)) {
      throw new ApiError(500, { code: ERROR_CODE.INTERNAL_SERVER_ERROR, message: '서버 내부 오류가 발생했습니다.', errors: [] })
    }
    findings.set(bookId, shelfId)
  }
  return findings
}

/**
 * 확인한 도서의 새 값과 확정 전 값에서 달라지는 건수. 마지막 확인 서가를 관측 서가로 바꾸고,
 * 소재불명(MISSING)이던 도서만 정상으로 되돌린다. 훼손·제적 상태와 정상 배치 서가는 바꾸지 않는다.
 */
export function reflectFindings(books: readonly MockBook[], findings: Findings) {
  const booksById = new Map(books.map((b) => [b.id, b]))
  let locationChanged = 0
  let restoredFromMissing = 0
  const updated = [...findings].map(([bookId, shelfId]): MockBook => {
    const book = booksById.get(bookId)
    if (!book) throw new Error(`Mock 데이터에 없는 도서입니다: ${bookId}`)
    const restored = book.lifecycleStatus === 'MISSING'
    if (book.currentShelfId !== shelfId) locationChanged += 1
    if (restored) restoredFromMissing += 1
    return { ...book, currentShelfId: shelfId, lifecycleStatus: restored ? 'NORMAL' : book.lifecycleStatus }
  })
  return { books: updated, locationChanged, restoredFromMissing }
}

/** 같은 ID의 도서를 새 값으로 바꾼 원장 */
export function replaceBooks(books: readonly MockBook[], updated: readonly MockBook[]): MockBook[] {
  const updatedById = new Map(updated.map((b) => [b.id, b]))
  return books.map((b) => updatedById.get(b.id) ?? b)
}

/**
 * 연속 미발견 횟수 (Backend MissingCandidateGenerator). 도서의 예상 서가를 직전에 점검한 확정 회차, 곧 그 서가의 결과를
 * 수신한 COMPLETED 회차 중 이번 회차보다 먼저 확정한 가장 최근 회차 하나만 본다. 그 회차에서도 후보였고 찾음·해결로
 * 종결되지 않았으면 직전 횟수 + 1, 그 외(발견·제외·이력 없음)는 1이다.
 */
export function consecutiveMissingCount(
  data: Pick<MockData, 'sessions' | 'sessionShelves' | 'missingCandidates'>,
  current: { sessionId: number; finalizedAt: string },
  { bookId, expectedShelfId }: Pick<MockMissingCandidate, 'bookId' | 'expectedShelfId'>,
): number {
  const key = (time: string | null) => (time === null ? '' : (timeKey(time) ?? ''))
  const checkedBy = new Set(
    data.sessionShelves
      .filter((link) => link.shelfId === expectedShelfId && link.scanStatus === 'RESULT_RECEIVED')
      .map((link) => link.sessionId),
  )
  let previous: MockSession | undefined
  for (const s of data.sessions) {
    if (s.id === current.sessionId || s.status !== 'COMPLETED' || !checkedBy.has(s.id)) continue
    if (key(s.finalizedAt) >= key(current.finalizedAt)) continue
    if (!previous || key(s.finalizedAt) > key(previous.finalizedAt)) previous = s
  }
  const last = data.missingCandidates.find((c) => c.sessionId === previous?.id && c.bookId === bookId)
  return last && !STREAK_BREAKING_STATUSES.includes(last.status) ? last.consecutiveMissingCount + 1 : 1
}

/**
 * 결과를 수신한 서가가 정상 배치 서가인데 이번 회차에서 발견되지 않은 도서. 다른 서가에서 확인한 도서도 발견이다.
 * 제적, 대출 중, 분실 처리 도서는 제외한다. 후보가 되어도 도서 원장은 바꾸지 않는다.
 */
function missingCandidatesOf(
  data: MockData,
  sessionId: number,
  findings: Findings,
  createdAt: string,
): MockMissingCandidate[] {
  const checkedShelves = new Set(
    data.sessionShelves
      .filter((link) => link.sessionId === sessionId && link.scanStatus === 'RESULT_RECEIVED')
      .map((link) => link.shelfId),
  )
  const firstId = data.missingCandidates.reduce((max, c) => Math.max(max, c.id), 0) + 1
  return data.books
    .flatMap((book) => {
      const { expectedShelfId } = book
      if (expectedShelfId === null || !checkedShelves.has(expectedShelfId) || findings.has(book.id)) return []
      if (book.lifecycleStatus === 'DISPOSED' || EXCLUDED_LOAN_STATUSES.includes(book.loanStatus)) return []
      return [{ bookId: book.id, expectedShelfId }]
    })
    .map((missing, index) => ({
      id: firstId + index,
      sessionId,
      createdAt,
      ...missing,
      consecutiveMissingCount: consecutiveMissingCount(data, { sessionId, finalizedAt: createdAt }, missing),
      status: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      note: null,
    }))
}

/**
 * 확정 시각. 보통은 현재 시각이다.
 * Mock 정책: 시드 시각은 고정돼 있어 현재 시계가 더 이를 수 있으므로,
 * 그때는 이 회차의 생성·시작·수신·검토 시각 중 가장 늦은 값을 쓴다.
 */
function finalizationTime(data: MockData, session: MockSession, now: string): string {
  const recorded = [
    session.createdAt,
    ...(session.startedAt === null ? [] : [session.startedAt]),
    ...data.observations.filter((o) => o.sessionId === session.id).map((o) => o.receivedAt),
    ...reviewsOf(data, session.id).map(({ review }) => review.reviewedAt),
  ]
  const isLater = (a: string, b: string) => (timeKey(a) ?? '') > (timeKey(b) ?? '')
  return recorded.reduce((latest, time) => (isLater(time, latest) ? time : latest), now)
}

/** 확정으로 바뀔 값과 응답을 계산한다. 저장소와 그 안의 객체는 바꾸지 않는다. */
export function planFinalization(
  data: MockData,
  session: MockSession,
  { now, userId }: { now: string; userId: number },
): FinalizationPlan {
  const findings = collectFindings(data, session.id)
  const reflection = reflectFindings(data.books, findings)
  const finalizedAt = finalizationTime(data, session, now)
  const missingCandidates = missingCandidatesOf(data, session.id, findings, finalizedAt)
  const reviews = reviewsOf(data, session.id)
  const countOf = (finalStatus: 'UNIDENTIFIED' | 'EXCLUDED') =>
    reviews.filter(({ review }) => review.finalStatus === finalStatus).length

  return {
    session: { ...session, status: 'COMPLETED', finalizedAt, finalizedBy: userId },
    books: reflection.books,
    missingCandidates,
    response: {
      sessionId: session.id,
      status: 'COMPLETED',
      finalizedAt,
      finalizedBy: userId,
      summary: {
        confirmedBooks: findings.size,
        locationChanged: reflection.locationChanged,
        restoredFromMissing: reflection.restoredFromMissing,
        unidentified: countOf('UNIDENTIFIED'),
        excluded: countOf('EXCLUDED'),
        missingCandidates: missingCandidates.length,
      },
    },
  }
}

/** 계산한 변경을 저장소에 넣는다. 여기서는 검사나 계산을 하지 않는다. */
export function applyFinalization(data: MockData, plan: FinalizationPlan): void {
  data.sessions = data.sessions.map((s) => (s.id === plan.session.id ? plan.session : s))
  data.books = replaceBooks(data.books, plan.books)
  data.missingCandidates = [...data.missingCandidates, ...plan.missingCandidates]
}
