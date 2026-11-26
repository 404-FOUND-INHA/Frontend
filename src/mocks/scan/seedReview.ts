import type { ObservationStatusReason } from '@/types/scan/analysis'
import type { MockBook, MockData, MockObservation, MockReview, MockSession, MockUser } from './types'

// 사서 검토의 결정적(deterministic) 시드. 자동 분석 시드(seedAnalysis.ts) 위에 검토 기록을 따로 쌓으며
// 관측은 바꾸지 않는다. 최종 판정은 규칙을 계산하지 않고 계획에 직접 적는다. (invariants.ts가 검증한다)
// 도서는 뒤에 추가만 하고, 상태를 바꾸는 도서는 아래의 소재불명(MISSING) 1권뿐이다.

const LIBRARIAN: MockUser = { id: 1, name: '김사서' }

type Decision =
  /** 자동 매칭된 도서를 확정한다. */
  | { kind: 'identifyMatched'; finalStatus: 'NORMAL' | 'MISPLACED' }
  /** 자동 분석이 찾지 못한 도서(소재불명이던 도서)를 관측 서가의 도서로 확정한다. */
  | { kind: 'identifyMissingBook' }
  | { kind: 'unidentified' }
  | { kind: 'exclude'; comment?: string }
  | { kind: 'pending' }

/** 사유별 결정. 같은 사유의 관측이 여럿이면 서가 ID → 배치 순서로 하나씩 대응한다. */
type SessionDecisions = Partial<Record<ObservationStatusReason, Decision[]>>

const identify = (finalStatus: 'NORMAL' | 'MISPLACED'): Decision => ({ kind: 'identifyMatched', finalStatus })
const UNIDENTIFIED: Decision = { kind: 'unidentified' }

// 회차 ID는 seed.ts의 SEED_SESSION_IDS와 같다. 주석의 값은 검토 완료 / 필수 검토.
const SCENARIO_DECISIONS: Record<number, SessionDecisions> = {
  // 2 / 3: 중복 2건은 하나를 확정하고 하나를 제외한다. 일치 없음 1건은 미처리
  2: {
    DUPLICATE_OBSERVATION: [identify('NORMAL'), { kind: 'exclude', comment: '같은 도서를 두 번 촬영함' }],
    NO_MATCH: [{ kind: 'pending' }],
  },
  // 7 / 7: 모든 조치와 판정. 제적 도서를 확정해도 제적 상태는 바뀌지 않는다.
  3: {
    DUPLICATE_OBSERVATION: [identify('NORMAL'), { kind: 'exclude' }],
    OCR_FAILED: [UNIDENTIFIED],
    NO_MATCH: [UNIDENTIFIED, { kind: 'identifyMissingBook' }],
    DISPOSED_BOOK: [identify('NORMAL')],
    NO_EXPECTED_SHELF: [identify('MISPLACED')],
  },
  // 1 / 1
  5: { NO_MATCH: [UNIDENTIFIED] },
  // 2 / 2
  6: { OCR_FAILED: [{ kind: 'exclude' }], DISPOSED_BOOK: [UNIDENTIFIED] },
}

/** 계획에 없는 완료 회차(이력)는 모든 필수 검토를 식별 불가로 마친다. 확정된 회차에는 미처리 검토가 없다. */
function decisionFor(session: MockSession, reason: ObservationStatusReason, index: number): Decision {
  const plan = SCENARIO_DECISIONS[session.id]
  if (!plan) {
    if (session.status !== 'COMPLETED') throw new Error(`회차 ${session.id}: 검토 시드 계획이 없습니다`)
    return UNIDENTIFIED
  }
  const decision = plan[reason]?.[index]
  if (!decision) throw new Error(`회차 ${session.id}: ${reason} ${index + 1}번째 관측의 검토 계획이 없습니다`)
  return decision
}

/** 회차 2에서만 관측되는 정상 도서 1권. 소재불명이던 도서를 자동 분석이 찾은 경우다. */
function findBookSeenOnlyIn(sessionId: number, observations: readonly MockObservation[]): number {
  const elsewhere = new Set(observations.filter((o) => o.sessionId !== sessionId).map((o) => o.bookId))
  const found = observations.findLast(
    (o) => o.sessionId === sessionId && o.analysisStatus === 'NORMAL' && !elsewhere.has(o.bookId),
  )
  if (!found || found.bookId === null) throw new Error(`회차 ${sessionId}에서만 관측되는 정상 도서가 없습니다`)
  return found.bookId
}

export function buildSeedReviews(
  source: Pick<MockData, 'sessions' | 'books' | 'observations'>,
): Pick<MockData, 'users' | 'books' | 'reviews'> {
  const missingId = findBookSeenOnlyIn(2, source.observations)
  const books: MockBook[] = source.books.map((b) => (b.id === missingId ? { ...b, lifecycleStatus: 'MISSING' } : { ...b }))
  const reviews: MockReview[] = []

  function addMissingBook(shelfId: number): number {
    const id = books.length + 1
    books.push({
      id,
      registrationNo: `EM${String(id).padStart(7, '0')}`,
      title: '검토에서 확인한 도서',
      callNumber: `813.7 검${id}`,
      copyNumber: null,
      lifecycleStatus: 'MISSING',
      expectedShelfId: shelfId,
      widthCm: 2.1,
    })
    return id
  }

  /** order: 회차의 필수 검토 중 몇 번째인가. 검토 시각을 1분 간격으로 둔다. */
  function record(o: MockObservation, order: number, decision: Pick<MockReview, 'action' | 'finalStatus' | 'finalBookId' | 'comment'>) {
    reviews.push({
      id: reviews.length + 1,
      observationId: o.id,
      reviewerId: LIBRARIAN.id,
      // 결과를 수신한 날 오후에 검토한다. (수신 이후, 확정 이전)
      reviewedAt: `${o.receivedAt.slice(0, 10)}T14:${String(order).padStart(2, '0')}:00`,
      ...decision,
    })
  }

  const identified = (finalBookId: number, finalStatus: 'NORMAL' | 'MISPLACED') =>
    ({ action: 'IDENTIFY_BOOK', finalStatus, finalBookId, comment: null }) as const

  for (const session of source.sessions) {
    const required = source.observations
      .filter((o) => o.sessionId === session.id && o.analysisStatus === 'REVIEW_REQUIRED')
      .sort((a, b) => a.shelfId - b.shelfId || a.detectedOrder - b.detectedOrder)
    const used = new Map<ObservationStatusReason, number>()
    for (const [order, o] of required.entries()) {
      const reason = o.statusReason as ObservationStatusReason
      const index = used.get(reason) ?? 0
      used.set(reason, index + 1)
      const decision = decisionFor(session, reason, index)
      switch (decision.kind) {
        case 'identifyMatched':
          if (o.bookId === null) throw new Error(`관측 ${o.id}: 자동 매칭 도서가 없습니다`)
          record(o, order, identified(o.bookId, decision.finalStatus))
          break
        case 'identifyMissingBook':
          record(o, order, identified(addMissingBook(o.shelfId), 'NORMAL'))
          break
        case 'unidentified':
          record(o, order, { action: 'MARK_UNIDENTIFIED', finalStatus: 'UNIDENTIFIED', finalBookId: null, comment: null })
          break
        case 'exclude':
          record(o, order, { action: 'EXCLUDE', finalStatus: 'EXCLUDED', finalBookId: null, comment: decision.comment ?? null })
          break
        case 'pending':
          break
      }
    }
  }
  return { users: [{ ...LIBRARIAN }], books, reviews }
}
