import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { ObservationStatusReason } from '@/types/scan/analysis'
import type { FinalizeSummary } from '@/types/scan/review'
import { planFinalization } from './finalize'
import { findInvariantViolations, findJudgementViolations } from './invariants'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from './seed'
import { createScanStore, type ScanStore } from './store'
import type { MockBook, MockData, MockObservation, MockReview } from './types'

const NOW = Date.parse('2026-11-26T03:00:00Z') // 서울 2026-11-26 12:00:00
const storeOf = (data: MockData = createSeedData(), now = NOW) => createScanStore(data, { now: () => now })

/** 확정이 실패하고 저장소 전체가 그대로인지 확인한다. */
function expectUnchangedFailure(store: ScanStore, sessionId: number, status: number, code: string): ApiError {
  const before = store.snapshot()
  let caught: unknown
  try {
    store.finalizeSession(sessionId)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ApiError)
  expect(caught).toMatchObject({ status, code })
  expect(store.snapshot()).toStrictEqual(before)
  return caught as ApiError
}

const summary = (
  confirmedBooks: number,
  locationChanged: number,
  restoredFromMissing: number,
  unidentified: number,
  excluded: number,
  missingCandidates: number,
): FinalizeSummary => ({ confirmedBooks, locationChanged, restoredFromMissing, unidentified, excluded, missingCandidates })

/** 확정 전후에 값이 달라진 도서: [ID, 바뀐 필드의 [이전, 이후]] */
function bookChanges(before: MockData, after: MockData) {
  expect(after.books.map((b) => b.id)).toEqual(before.books.map((b) => b.id))
  return after.books.flatMap((book, index) => {
    const old = before.books[index]
    const fields = (Object.keys(book) as (keyof MockBook)[]).filter((key) => book[key] !== old[key])
    return fields.length === 0
      ? []
      : [[book.id, Object.fromEntries(fields.map((key) => [key, [old[key], book[key]]]))] as const]
  })
}

const candidateBookIds = (data: MockData, sessionId: number) =>
  data.missingCandidates.filter((c) => c.sessionId === sessionId).map((c) => c.bookId)

describe('확정할 수 없는 경우', () => {
  it.each([
    ['수신 전 회차', SEED_SESSION_IDS.VISION_WAITING],
    ['이미 확정한 회차', SEED_SESSION_IDS.COMPLETED_LATEST],
    ['관측 없이 확정한 이력과 같은 완료 회차', SEED_SESSION_IDS.COMPLETED_CLEAN],
  ])('%s는 409 SCAN_009이고 아무것도 바뀌지 않는다', (_label, sessionId) => {
    const error = expectUnchangedFailure(storeOf(), sessionId, 409, ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE)
    expect(error.message).toBe('확정할 수 있는 회차 상태가 아닙니다.')
  })

  it('미처리 필수 검토가 있으면 409 SCAN_010이며 남은 건수를 알려 준다', () => {
    const error = expectUnchangedFailure(storeOf(), SEED_SESSION_IDS.REVIEW_PARTIAL, 409, ERROR_CODE.SCAN_REVIEW_INCOMPLETE)
    expect(error.message).toBe('검토가 끝나지 않은 관측이 1건 있어 확정할 수 없습니다.')
  })

  it('남은 건수는 검토 기록에서 계산한다', () => {
    const data = createSeedData()
    const ids = new Set(data.observations.filter((o) => o.sessionId === 3).map((o) => o.id))
    data.reviews = data.reviews.filter((r) => !ids.has(r.observationId))
    const error = expectUnchangedFailure(storeOf(data), 3, 409, ERROR_CODE.SCAN_REVIEW_INCOMPLETE)
    expect(error.message).toContain('7건')
  })

  it('상태 확인이 미처리 검토 확인보다 먼저다', () => {
    const data = createSeedData()
    data.sessions[1].status = 'IN_PROGRESS' // 미처리 검토가 있는 회차 2
    expectUnchangedFailure(storeOf(data), 2, 409, ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE)
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('ID %s는 400이다', (sessionId) => {
    expectUnchangedFailure(storeOf(), sessionId, 400, ERROR_CODE.INVALID_INPUT)
  })

  it.each([0, -1, 999])('없는 회차 %s는 404 SCAN_001이다', (sessionId) => {
    expectUnchangedFailure(storeOf(), sessionId, 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
  })

  it('같은 회차를 두 번 확정하면 두 번째는 실패하고 후보가 다시 생기지 않는다', () => {
    const store = storeOf()
    store.finalizeSession(3)
    expectUnchangedFailure(store, 3, 409, ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE)
    expect(candidateBookIds(store.snapshot(), 3)).toHaveLength(21)
  })
})

describe('시드 회차 3 확정 (모든 검토 완료)', () => {
  const run = () => {
    const store = storeOf()
    const before = store.snapshot()
    const response = store.finalizeSession(SEED_SESSION_IDS.REVIEW_COMPLETE)
    return { store, before, response, after: store.snapshot() }
  }

  it('Backend 형태의 응답을 돌려준다', () => {
    expect(run().response).toStrictEqual({
      sessionId: 3,
      status: 'COMPLETED',
      finalizedAt: '2026-11-26T12:00:00',
      finalizedBy: 1,
      summary: summary(93, 7, 1, 2, 1, 21),
    })
  })

  it('회차만 확정 상태가 되고 다른 회차, 서가 관계, 관측, 검토, 사용자는 그대로다', () => {
    const { before, after } = run()
    expect(after.sessions.find((s) => s.id === 3)).toEqual({
      ...before.sessions.find((s) => s.id === 3),
      status: 'COMPLETED',
      finalizedAt: '2026-11-26T12:00:00',
      finalizedBy: 1,
    })
    expect(after.sessions.filter((s) => s.id !== 3)).toStrictEqual(before.sessions.filter((s) => s.id !== 3))
    for (const key of ['shelves', 'sessionShelves', 'observations', 'reviews', 'users'] as const) {
      expect(after[key]).toStrictEqual(before[key])
    }
    expect(findInvariantViolations(after)).toEqual([])
    expect(findJudgementViolations(after)).toEqual([])
  })

  it('도서는 확인 서가가 바뀐 7권과 소재불명에서 복구한 1권만 달라진다', () => {
    const { before, after } = run()
    expect(bookChanges(before, after)).toStrictEqual([
      [127, { currentShelfId: [10, 9] }],
      [128, { currentShelfId: [10, 9] }],
      [130, { currentShelfId: [11, 10] }],
      [131, { currentShelfId: [11, 10] }],
      [132, { currentShelfId: [null, 10] }], // 예상 서가가 없던 도서를 사서가 확정
      [133, { currentShelfId: [12, 11] }],
      [134, { currentShelfId: [12, 11] }],
      [418, { lifecycleStatus: ['MISSING', 'NORMAL'] }], // 위치는 그대로라 위치 변경에 세지 않는다
    ])
  })

  it('후보는 점검 서가가 예상 서가인데 발견하지 못한 대상 도서 전부이며 응답 건수와 같다', () => {
    const { before, after, response } = run()
    const observed = before.observations.filter((o) => o.sessionId === 3)
    const found = new Set([
      ...observed.filter((o) => o.analysisStatus !== 'REVIEW_REQUIRED').map((o) => o.bookId),
      ...before.reviews.filter((r) => observed.some((o) => o.id === r.observationId)).map((r) => r.finalBookId),
    ])
    const expected = before.books.filter(
      (b) =>
        [9, 10, 11, 12].includes(b.expectedShelfId ?? 0) &&
        !found.has(b.id) &&
        b.lifecycleStatus !== 'DISPOSED' &&
        b.loanStatus !== 'ON_LOAN' &&
        b.loanStatus !== 'LOST',
    )
    expect(candidateBookIds(after, 3)).toEqual(expected.map((b) => b.id))
    const created = after.missingCandidates.slice(before.missingCandidates.length) // 시드 후보 뒤에 이어 붙는다
    expect(response.summary.missingCandidates).toBe(created.length)
    expect(created.map((c) => c.id)).toEqual(expected.map((_, i) => before.missingCandidates.length + i + 1))
    for (const c of created) {
      expect(c).toMatchObject({ sessionId: 3, status: 'PENDING', reviewedBy: null, reviewedAt: null, note: null })
      expect(c.createdAt).toBe(response.finalizedAt)
      expect(c.expectedShelfId).toBe(after.books.find((b) => b.id === c.bookId)?.expectedShelfId)
    }
  })

  it('미관측 도서 중 대출 중·분실 처리·제적은 제외하고 소재불명·훼손·예약은 후보로 두며 원장은 바꾸지 않는다', () => {
    const { before, after } = run()
    const unobserved = after.books.slice(-6)
    const candidates = new Set(candidateBookIds(after, 3))
    expect(unobserved.map((b) => [b.title, candidates.has(b.id)])).toEqual([
      ['대출 중인 미관측 도서', false],
      ['분실 처리된 미관측 도서', false],
      ['제적된 미관측 도서', false],
      ['소재불명인 미관측 도서', true],
      ['훼손된 미관측 도서', true],
      ['예약된 미관측 도서', true],
    ])
    expect(unobserved).toStrictEqual(before.books.slice(-6))
  })

  it('조회 결과는 확정 상태를 반영하고 분석·검토 내용은 확정 전과 같다', () => {
    const store = storeOf()
    const analysis = store.getAnalysis(3)
    const reviews = store.getReviews(3, { size: 100 })
    const session = store.getSession(3)

    store.finalizeSession(3)

    const finalized = { ...session, status: 'COMPLETED', finalizedAt: '2026-11-26T12:00:00' }
    expect(store.getSession(3)).toStrictEqual(finalized) // finalizedBy는 회차 응답에 없다
    expect(store.getSessions({ status: ['REVIEW'] }).content.map((s) => s.id)).toEqual([4, 2])
    expect(store.getSessions({ status: ['COMPLETED'], size: 100 }).content.find((s) => s.id === 3)).toStrictEqual(finalized)
    expect(store.getAnalysis(3)).toEqual({ ...analysis, session: { id: 3, status: 'COMPLETED', processingStage: 'ANALYSIS_DONE' } })
    // 검토의 도서 정보는 원장의 현재 값이지만 BookBrief에는 상태와 확인 서가가 없어 내용이 같다.
    expect(store.getReviews(3, { size: 100 })).toStrictEqual(reviews)
  })

  it('확정한 자료실에는 새 회차를 만들 수 있다', () => {
    const store = storeOf()
    const request = { sessionName: '새 자연과학 점검', zone: SEED_ZONES.SCIENCE }
    expect(() => store.createSession(request)).toThrow('완료되지 않은 점검 회차')

    store.finalizeSession(3)

    expect(store.getRooms().find((r) => r.zone === SEED_ZONES.SCIENCE)?.hasOpenSession).toBe(false)
    const created = store.createSession(request)
    expect(created.status).toBe('IN_PROGRESS')
    expect(store.snapshot().sessions.find((s) => s.id === created.id)?.finalizedBy).toBeNull()
    expectUnchangedFailure(store, created.id, 409, ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE)
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })

  it('응답을 바꿔도 저장소에는 영향이 없다', () => {
    const { store, response, after } = run()
    response.summary.confirmedBooks = 0
    response.finalizedAt = '변경'
    expect(store.snapshot()).toStrictEqual(after)
  })
})

describe('시드 회차 4 확정 (필수 검토와 관측 0건)', () => {
  it('도서는 바꾸지 않고 점검 서가의 도서를 모두 후보로 만든다', () => {
    const store = storeOf()
    const before = store.snapshot()
    const response = store.finalizeSession(SEED_SESSION_IDS.REVIEW_NONE)
    const after = store.snapshot()

    expect(response.summary).toStrictEqual(summary(0, 0, 0, 0, 0, 30))
    expect(after.books).toStrictEqual(before.books)
    expect(candidateBookIds(after, 4)).toHaveLength(30)
    const created = after.missingCandidates.slice(before.missingCandidates.length)
    expect(new Set(created.map((c) => c.expectedShelfId))).toEqual(new Set([13, 14]))
    expect(findInvariantViolations(after)).toEqual([])
    expect(findJudgementViolations(after)).toEqual([])
  })

  it('회차를 이어서 확정하면 앞의 후보를 유지하고 ID를 이어 붙인다', () => {
    const store = storeOf()
    store.finalizeSession(3)
    const first = store.snapshot().missingCandidates
    store.finalizeSession(4)
    const all = store.snapshot().missingCandidates

    expect(all.slice(0, first.length)).toStrictEqual(first)
    expect(all.map((c) => c.id)).toEqual(Array.from({ length: 6 + 21 + 30 }, (_, i) => i + 1)) // 시드 6건 포함
  })

  it('점검 서가에 대상 도서가 없으면 후보 0건으로 확정한다', () => {
    const data = createSeedData()
    data.books.filter((b) => [13, 14].includes(b.expectedShelfId ?? 0)).forEach((b) => (b.loanStatus = 'ON_LOAN'))
    const store = storeOf(data)
    expect(store.finalizeSession(4).summary).toStrictEqual(summary(0, 0, 0, 0, 0, 0))
    expect(store.getSession(4).status).toBe('COMPLETED')
  })
})

// ── 테스트 전용 데이터 ──

const book = (id: number, overrides: Partial<MockBook> = {}): MockBook => ({
  id,
  registrationNo: `T${id}`,
  title: `도서 ${id}`,
  callNumber: `813.7 김${id}`,
  copyNumber: null,
  lifecycleStatus: 'NORMAL',
  expectedShelfId: 1,
  currentShelfId: 1,
  loanStatus: 'AVAILABLE',
  widthCm: 2,
  ...overrides,
})

const observation = (id: number, bookId: number | null, overrides: Partial<MockObservation> = {}): MockObservation => ({
  id,
  sessionId: 1,
  shelfId: 1,
  detectedOrder: id,
  xPositionCm: null,
  detectedLabelRaw: null,
  detectedTitle: null,
  detectedClassificationNo: null,
  detectedBookSymbol: null,
  detectedCopyNumber: null,
  detectedAt: null,
  receivedAt: '2026-11-01T11:00:00',
  analysisStatus: 'NORMAL',
  statusReason: null,
  matchConfidence: bookId === null ? null : 1,
  bookId,
  candidates: [],
  ...overrides,
})

const misplaced = (id: number, bookId: number, overrides: Partial<MockObservation> = {}) =>
  observation(id, bookId, { analysisStatus: 'MISPLACED', statusReason: 'WRONG_SHELF', ...overrides })

const required = (
  id: number,
  bookId: number | null,
  statusReason: ObservationStatusReason,
  overrides: Partial<MockObservation> = {},
) => observation(id, bookId, { analysisStatus: 'REVIEW_REQUIRED', statusReason, ...overrides })

const review = (id: number, observationId: number, overrides: Partial<MockReview> = {}): MockReview => ({
  id,
  observationId,
  action: 'MARK_UNIDENTIFIED',
  finalStatus: 'UNIDENTIFIED',
  finalBookId: null,
  reviewerId: 1,
  comment: null,
  reviewedAt: '2026-11-01T14:00:00',
  ...overrides,
})

const identified = (id: number, observationId: number, finalBookId: number, finalStatus: 'NORMAL' | 'MISPLACED') =>
  review(id, observationId, { action: 'IDENTIFY_BOOK', finalStatus, finalBookId })

/** 회차 1은 서가 1·2, 회차 2는 서가 3을 점검한다. 두 회차 모두 REVIEW다. */
function customData(overrides: Partial<MockData> = {}): MockData {
  const session = (id: number) => ({
    id,
    sessionName: `회차 ${id}`,
    status: 'REVIEW' as const,
    zone: id === 1 ? 'X' : 'Y',
    plannedStartDate: null,
    startedAt: '2026-11-01T09:00:00',
    finalizedAt: null,
    finalizedBy: null,
    createdAt: '2026-11-01T09:00:00',
  })
  return {
    shelves: [1, 2, 3].map((id) => ({
      id,
      shelfCode: `S-${id}`,
      zone: id === 3 ? 'Y' : 'X',
      floorNo: 1,
      widthCm: 90,
      displayOrder: id,
      active: true,
    })),
    sessions: [session(1), session(2)],
    sessionShelves: [
      { sessionId: 1, shelfId: 1, scanStatus: 'RESULT_RECEIVED' },
      { sessionId: 1, shelfId: 2, scanStatus: 'RESULT_RECEIVED' },
      { sessionId: 2, shelfId: 3, scanStatus: 'RESULT_RECEIVED' },
    ],
    books: [],
    observations: [],
    users: [{ id: 1, name: '사서' }],
    reviews: [],
    missingCandidates: [],
    ...overrides,
  }
}

/** 원장 반영과 후보 산출의 경우를 한 회차에 모은 데이터 */
const ledgerData = () =>
  customData({
    books: [
      // 발견하는 도서
      book(1),
      book(2, { lifecycleStatus: 'MISSING', expectedShelfId: 2, currentShelfId: 2 }),
      book(3, { lifecycleStatus: 'DAMAGED', currentShelfId: 2 }),
      book(4, { lifecycleStatus: 'DISPOSED', currentShelfId: null }),
      book(5, { lifecycleStatus: 'MISSING', expectedShelfId: 2 }),
      book(6, { loanStatus: 'ON_LOAN' }),
      book(7), // 다른 서가(2)에서 발견
      // 발견하지 못하는 후보
      book(8, { lifecycleStatus: 'MISSING' }),
      book(9, { lifecycleStatus: 'DAMAGED', expectedShelfId: 2, currentShelfId: 2 }),
      book(10, { loanStatus: 'RESERVED', expectedShelfId: 2 }),
      book(11, { currentShelfId: null }),
      // 후보에서 제외
      book(12, { lifecycleStatus: 'DISPOSED' }),
      book(13, { loanStatus: 'ON_LOAN' }),
      book(14, { loanStatus: 'LOST' }),
      book(15, { expectedShelfId: 3, currentShelfId: 1 }), // 점검하지 않은 서가의 도서
      book(16, { expectedShelfId: null }),
      book(17, { lifecycleStatus: 'MISSING', loanStatus: 'ON_LOAN' }),
      // 관측은 됐지만 검토에서 확정하지 않은 도서(후보), 다른 회차에서만 확인한 도서(후보)
      book(18, { currentShelfId: 3 }),
      book(19),
    ],
    observations: [
      observation(1, 1),
      misplaced(2, 2),
      observation(3, 3),
      required(4, 4, 'DISPOSED_BOOK'),
      required(5, null, 'OCR_FAILED', { matchConfidence: null }),
      observation(6, 6),
      misplaced(7, 7, { shelfId: 2 }),
      required(8, 18, 'DUPLICATE_OBSERVATION', { shelfId: 2 }),
      required(9, 18, 'DUPLICATE_OBSERVATION', { shelfId: 2 }),
      misplaced(10, 19, { sessionId: 2, shelfId: 3 }),
    ],
    reviews: [
      identified(1, 4, 4, 'NORMAL'),
      identified(2, 5, 5, 'MISPLACED'),
      review(3, 8, { action: 'EXCLUDE', finalStatus: 'EXCLUDED' }),
      review(4, 9),
    ],
  })

describe('도서 원장 반영', () => {
  const run = () => {
    const data = ledgerData()
    expect(findInvariantViolations(data)).toEqual([])
    expect(findJudgementViolations(data)).toEqual([])
    const store = storeOf(data)
    const before = store.snapshot()
    const response = store.finalizeSession(1)
    return { store, before, response, after: store.snapshot() }
  }

  it('확인 서가를 관측 서가로 바꾸고 소재불명만 정상으로 되돌린다', () => {
    const { before, after } = run()
    // 훼손(3)·제적(4)은 유지, 예상 서가는 모두 유지, 미확정 관측의 도서(18)는 그대로
    expect(bookChanges(before, after)).toStrictEqual([
      [2, { lifecycleStatus: ['MISSING', 'NORMAL'], currentShelfId: [2, 1] }],
      [3, { currentShelfId: [2, 1] }],
      [4, { currentShelfId: [null, 1] }],
      [5, { lifecycleStatus: ['MISSING', 'NORMAL'] }],
      [7, { currentShelfId: [1, 2] }],
    ])
  })

  it('건수는 확정 전 원장과 비교해 계산한다', () => {
    expect(run().response.summary).toStrictEqual(summary(7, 4, 2, 1, 1, 6))
  })

  it('후보 산출 기준: 발견·제적·대출 중·분실·점검하지 않은 서가·예상 서가 없음은 제외한다', () => {
    const { after, before } = run()
    expect(candidateBookIds(after, 1)).toEqual([8, 9, 10, 11, 18, 19])
    expect(after.missingCandidates.map((c) => [c.bookId, c.expectedShelfId])).toEqual([
      [8, 1],
      [9, 2],
      [10, 2],
      [11, 1],
      [18, 1],
      [19, 1],
    ])
    expect(after.books.slice(7)).toStrictEqual(before.books.slice(7))
    expect(findInvariantViolations(after)).toEqual([])
    expect(findJudgementViolations(after)).toEqual([])
  })

  it('자동 판정과 검토 기록은 그대로이고 분석 조회의 도서 상태만 현재 값이 된다', () => {
    const { store, before, after } = run()
    expect(after.observations).toStrictEqual(before.observations)
    expect(after.reviews).toStrictEqual(before.reviews)
    expect(store.getObservation(1, 2)).toMatchObject({
      analysisStatus: 'MISPLACED',
      statusReason: 'WRONG_SHELF',
      matchedBook: { lifecycleStatus: 'NORMAL', expectedShelfId: 2 },
    })
    expect(Object.keys(store.getObservation(1, 2).matchedBook as object)).not.toContain('currentShelfId')
    expect(Object.keys(store.getObservation(1, 2).matchedBook as object)).not.toContain('loanStatus')
  })

  it('결과를 수신하지 않은 서가의 도서는 후보가 아니다', () => {
    const data = ledgerData()
    // 정상 데이터의 REVIEW 회차에는 없는 상태지만 산출 기준 자체를 확인한다.
    data.sessionShelves[1].scanStatus = 'WAITING'
    const store = storeOf(data)
    store.finalizeSession(1)
    expect(candidateBookIds(store.snapshot(), 1)).toEqual([8, 11, 18, 19])
  })
})

describe('원자성', () => {
  it('계산 단계는 저장 데이터를 바꾸지 않고 바뀔 값을 새 객체로 만든다', () => {
    const freeze = <T>(value: T): T => {
      if (value !== null && typeof value === 'object') Object.values(value).forEach(freeze)
      return Object.freeze(value)
    }
    const data = freeze(ledgerData())
    const original = structuredClone(data)
    const plan = planFinalization(data, data.sessions[0], { now: '2026-11-26T12:00:00', userId: 1 })

    expect(data).toStrictEqual(original)
    expect(plan.session).not.toBe(data.sessions[0])
    for (const updated of plan.books) expect(data.books).not.toContain(updated)
    expect(plan.response.summary.missingCandidates).toBe(plan.missingCandidates.length)
  })

  it.each<[string, (data: MockData) => void]>([
    ['자동 확인 두 건이 같은 도서', (d) => d.observations.push(observation(11, 1, { detectedOrder: 11 }))],
    ['자동 확인과 사서 확정이 같은 도서', (d) => (d.reviews[1].finalBookId = 1)],
    ['사서 확정 두 건이 같은 도서', (d) => (d.reviews[1].finalBookId = 4)],
  ])('%s이면 500 COMMON_999이고 아무것도 바뀌지 않는다', (_label, corrupt) => {
    const data = ledgerData()
    corrupt(data)
    const error = expectUnchangedFailure(storeOf(data), 1, 500, ERROR_CODE.INTERNAL_SERVER_ERROR)
    expect(error.message).toBe('서버 내부 오류가 발생했습니다.')
  })

  it('원장 반영 계산이 중간에 실패해도 아무것도 바뀌지 않는다', () => {
    const data = ledgerData()
    data.reviews[1].finalBookId = 999 // 앞의 도서들을 계산한 뒤에 실패한다
    const store = storeOf(data)
    const before = store.snapshot()
    expect(() => store.finalizeSession(1)).toThrow('Mock 데이터에 없는 도서')
    expect(store.snapshot()).toStrictEqual(before)
  })

  it('실패한 확정은 후보 ID를 쓰지 않는다', () => {
    const data = ledgerData()
    data.reviews[1].finalBookId = 1
    data.books.push(book(20, { expectedShelfId: 3, currentShelfId: 3 }))
    const store = storeOf(data)
    expectUnchangedFailure(store, 1, 500, ERROR_CODE.INTERNAL_SERVER_ERROR)
    store.finalizeSession(2)
    expect(store.snapshot().missingCandidates.map((c) => [c.id, c.bookId])).toEqual([
      [1, 15],
      [2, 20],
    ])
  })

  it('다른 회차의 중복 확정 데이터는 영향을 주지 않는다', () => {
    const data = ledgerData()
    data.reviews[1].finalBookId = 19 // 회차 2에서만 확인한 도서를 회차 1에서도 확정
    expect(storeOf(data).finalizeSession(1).status).toBe('COMPLETED')
  })
})

describe('확정 시각', () => {
  const timed = (receivedAt: string, reviewedAt?: string) =>
    customData({
      books: [book(1)],
      observations: reviewedAt
        ? [required(1, null, 'OCR_FAILED', { matchConfidence: null, receivedAt })]
        : [observation(1, 1, { receivedAt })],
      reviews: reviewedAt ? [review(1, 1, { reviewedAt })] : [],
    })
  const atNoon = Date.parse('2026-11-01T03:00:00Z') // 서울 2026-11-01 12:00:00

  it.each([
    ['현재 시각이 기록보다 늦으면 현재 시각', '2026-11-01T11:00:00', '2026-11-01T11:30:00', '2026-11-01T12:00:00'],
    ['검토가 현재 시각보다 늦으면 검토 시각', '2026-11-01T11:00:00', '2026-11-01T14:00:00', '2026-11-01T14:00:00'],
    ['마이크로초만 늦어도 검토 시각', '2026-11-01T11:00:00', '2026-11-01T12:00:00.000001', '2026-11-01T12:00:00.000001'],
    ['표기만 다른 같은 시각이면 현재 시각', '2026-11-01T11:00:00', '2026-11-01T12:00:00.000000', '2026-11-01T12:00:00'],
    ['검토가 없고 수신이 늦으면 수신 시각', '2026-11-01T12:00:00.5', undefined, '2026-11-01T12:00:00.5'],
  ])('%s', (_label, receivedAt, reviewedAt, expected) => {
    const store = storeOf(timed(receivedAt, reviewedAt), atNoon)
    expect(store.finalizeSession(1).finalizedAt).toBe(expected)
    expect(store.getSession(1).finalizedAt).toBe(expected)
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })

  /** 확정 시각이 응답, 회차 조회, 저장한 후보에서 모두 같고 정합성이 유지되는지 확인한다. */
  const expectFinalizedAt = (store: ScanStore, sessionId: number, expected: string) => {
    expect(store.finalizeSession(sessionId).finalizedAt).toBe(expected)
    expect(store.getSession(sessionId).finalizedAt).toBe(expected)
    const candidates = store.snapshot().missingCandidates.filter((c) => c.sessionId === sessionId)
    expect(candidates.length).toBeGreaterThan(0)
    expect(new Set(candidates.map((c) => c.createdAt))).toEqual(new Set([expected]))
  }

  it('시계가 시드 기록보다 이른 환경에서도 정합성을 유지한다', () => {
    const store = storeOf(createSeedData(), Date.parse('2026-01-01T00:00:00Z'))
    expectFinalizedAt(store, 3, '2026-11-04T14:06:00') // 회차 3의 마지막 검토
    expectFinalizedAt(store, 4, '2026-11-05T09:00:00') // 관측·검토가 없으면 회차의 생성·시작 시각
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })

  /** 관측과 검토가 없는 회차 1. 서가 1의 도서가 후보가 된다. */
  const unobserved = (createdAt: string, startedAt: string | null) => {
    const data = customData({ books: [book(1)] })
    Object.assign(data.sessions[0], { createdAt, startedAt })
    return data
  }

  it.each([
    ['현재 시각이 생성·시작보다 이르면 그 시각', '14:00:00', '14:00:00', '14:00:00'],
    ['시작이 생성보다 늦으면 시작 시각', '13:00:00', '14:00:00', '14:00:00'],
    ['생성이 시작보다 늦으면 생성 시각', '14:00:00', '13:00:00', '14:00:00'],
    ['마이크로초만 늦어도 시작 시각', '09:00:00', '12:00:00.000001', '12:00:00.000001'],
    ['현재 시각이 생성·시작보다 늦으면 현재 시각', '09:00:00', '10:00:00', '12:00:00'],
  ])('%s', (_label, created, started, expected) => {
    const at = (time: string) => `2026-11-01T${time}`
    const store = storeOf(unobserved(at(created), at(started)), atNoon)
    expectFinalizedAt(store, 1, at(expected))
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })

  it('시작 시각이 없으면 생성 시각만 비교한다', () => {
    const store = storeOf(unobserved('2026-11-01T14:00:00', null), atNoon)
    expectFinalizedAt(store, 1, '2026-11-01T14:00:00')
    // startedAt 누락은 기존 규칙대로 그 필드의 위반이다.
    expect(findInvariantViolations(store.snapshot())).toEqual(['회차 1: startedAt 형식 오류'])
  })

  it.each([
    ['검토보다 늦은 밀리초는 현재 시각', '12:00:00.100001', '12:00:00.900'],
    ['현재 시각 직전의 마이크로초 검토면 현재 시각', '12:00:00.899999', '12:00:00.900'],
    ['현재 시각보다 마이크로초 늦은 검토면 검토 시각', '12:00:00.900001', '12:00:00.900001'],
  ])('같은 초: %s', (_label, reviewed, expected) => {
    const store = storeOf(timed('2026-11-01T11:00:00', `2026-11-01T${reviewed}`), atNoon + 900)
    expectFinalizedAt(store, 1, `2026-11-01T${expected}`)
    expect(store.snapshot().reviews[0].reviewedAt).toBe(`2026-11-01T${reviewed}`)
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })

  it('같은 초에 이어서 확정해도 현재 시각의 밀리초가 남아 순서가 유지된다', () => {
    const data = createSeedData()
    const observationIds = new Set(data.observations.filter((o) => o.sessionId === 3).map((o) => o.id))
    const last = data.reviews.find((r) => observationIds.has(r.observationId)) as MockReview
    last.reviewedAt = '2026-11-26T12:00:00.100001'
    let clock = NOW + 900
    const store = createScanStore(data, { now: () => clock })

    expectFinalizedAt(store, 3, '2026-11-26T12:00:00.900')
    clock = NOW + 901
    expectFinalizedAt(store, 4, '2026-11-26T12:00:00.901')
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })
})

describe('시드의 확정 관련 데이터', () => {
  it('확정자는 완료 회차에만 있다', () => {
    const data = createSeedData()
    expect(data.sessions.every((s) => s.finalizedBy === (s.status === 'COMPLETED' ? 1 : null))).toBe(true)
  })

  it('확인 서가는 완료 회차의 마지막 확인 결과이고, 확인한 적이 없으면 예상 서가다', () => {
    const data = createSeedData()
    const completed = data.sessions
      .filter((s) => s.status === 'COMPLETED')
      .sort((a, b) => (a.finalizedAt! < b.finalizedAt! ? -1 : 1))
    const lastSeen = new Map<number, number>()
    for (const session of completed) {
      for (const o of data.observations) {
        if (o.sessionId === session.id && o.bookId !== null && o.analysisStatus !== 'REVIEW_REQUIRED') {
          lastSeen.set(o.bookId, o.shelfId)
        }
      }
    }
    for (const b of data.books) expect([b.id, b.currentShelfId]).toEqual([b.id, lastSeen.get(b.id) ?? b.expectedShelfId])
    // 완료 회차의 오배치 도서가 있어 예상 서가와 다른 도서가 있다.
    expect(data.books.some((b) => b.currentShelfId !== b.expectedShelfId)).toBe(true)
  })

  it('미관측 도서는 어느 회차의 관측과 검토에도 없다', () => {
    const data = createSeedData()
    const ids = new Set(data.books.slice(-6).map((b) => b.id))
    expect(data.observations.some((o) => o.bookId !== null && ids.has(o.bookId))).toBe(false)
    expect(data.reviews.some((r) => r.finalBookId !== null && ids.has(r.finalBookId))).toBe(false)
  })
})

describe('확정 정보와 후보의 정합성 검사', () => {
  const finalized = () => {
    const store = storeOf(ledgerData())
    store.finalizeSession(1)
    return store.snapshot()
  }

  it.each<[string, (d: MockData) => void, string]>([
    ['확정자 없는 완료 회차', (d) => (d.sessions[0].finalizedBy = null), '회차 1: finalizedBy는 COMPLETED에만'],
    ['확정자 있는 미완료 회차', (d) => (d.sessions[1].finalizedBy = 1), '회차 2: finalizedBy는 COMPLETED에만'],
    ['없는 확정자', (d) => (d.sessions[0].finalizedBy = 999), '존재하지 않는 확정자 999'],
    ['수신보다 이른 확정', (d) => (d.observations[0].receivedAt = '2026-11-26T12:00:00.000001'), '결과 수신 전에 확정'],
    ['없는 확인 서가', (d) => (d.books[0].currentShelfId = 999), '존재하지 않는 확인 서가 999'],
    ['후보 ID 중복', (d) => (d.missingCandidates[1].id = 1), '후보 ID가 중복'],
    ['같은 도서의 후보 2건', (d) => (d.missingCandidates[1].bookId = 8), '도서의 후보가 중복'],
    ['없는 도서의 후보', (d) => (d.missingCandidates[0].bookId = 999), '존재하지 않는 도서 999'],
    ['자동 확인한 도서의 후보', (d) => (d.missingCandidates[0].bookId = 1), '이 회차에서 발견한 도서 1'],
    ['사서가 확정한 도서의 후보', (d) => (d.missingCandidates[0].bookId = 5), '이 회차에서 발견한 도서 5'],
    ['점검하지 않은 서가의 후보', (d) => (d.missingCandidates[0].expectedShelfId = 3), '수신한 대상 서가의 도서가 아님'],
    ['미완료 회차의 후보', (d) => (d.missingCandidates[0].sessionId = 2), '확정한 회차에만'],
    ['확정 시각과 다른 생성 시각', (d) => (d.missingCandidates[0].createdAt = '2026-11-26T12:00:01'), '회차의 확정 시각이어야'],
    ['생성 시각 형식', (d) => (d.missingCandidates[0].createdAt = '2026-11-26'), '후보 1: createdAt 형식 오류'],
    ['0회인 연속 미발견', (d) => (d.missingCandidates[0].consecutiveMissingCount = 0), '1 이상의 정수'],
    ['확인 전 후보의 메모', (d) => (d.missingCandidates[0].note = '메모'), '확인 기록이 없어야 함'],
    ['확인자 없는 확인 결과', (d) => (d.missingCandidates[0].status = 'FOUND'), '확인자와 확인 시각이 있어야 함'],
    [
      '없는 확인자',
      (d) => Object.assign(d.missingCandidates[0], { status: 'FOUND', reviewedBy: 999, reviewedAt: '2026-11-27T09:00:00' }),
      '존재하지 않는 확인자 999',
    ],
    [
      '생성보다 이른 확인',
      (d) => Object.assign(d.missingCandidates[0], { status: 'FOUND', reviewedBy: 1, reviewedAt: '2026-11-26T11:59:59' }),
      '후보 생성 전에 확인',
    ],
  ])('위반 검출: %s', (_label, corrupt, message) => {
    const data = finalized()
    expect(findInvariantViolations(data)).toEqual([])
    corrupt(data)
    expect(findInvariantViolations(data).join('\n')).toContain(message)
  })

  it.each([
    ['createdAt', '회차 1: 생성 전에 확정할 수 없음'],
    ['startedAt', '회차 1: 시작 전에 확정할 수 없음'],
  ] as const)('%s보다 마이크로초라도 이른 확정은 위반이고 같은 시각은 허용한다', (field, message) => {
    const data = finalized() // 확정 시각 2026-11-26T12:00:00
    data.sessions[0][field] = '2026-11-26T12:00:00.000000'
    expect(findInvariantViolations(data)).toEqual([])
    data.sessions[0][field] = '2026-11-26T12:00:00.000001'
    expect(findInvariantViolations(data)).toEqual([message])
  })

  it.each(['createdAt', 'startedAt'] as const)('유효하지 않은 %s은 형식 위반 하나로만 알린다', (field) => {
    const data = finalized()
    data.sessions[0][field] = '2026-11-26T25:00:00'
    expect(findInvariantViolations(data)).toEqual([`회차 1: ${field} 형식 오류`])
  })

  it.each<[string, (b: MockBook) => void, string]>([
    ['예상 서가가 다름', (b) => (b.expectedShelfId = 2), '도서의 예상 서가와 다름'],
    ['제적', (b) => (b.lifecycleStatus = 'DISPOSED'), '제적 도서는 후보가 아님'],
    ['대출 중', (b) => (b.loanStatus = 'ON_LOAN'), '대출 중·분실'],
    ['분실 처리', (b) => (b.loanStatus = 'LOST'), '대출 중·분실'],
  ])('산출 당시 기준: %s (이후의 원장 변경은 저장 데이터 위반이 아니다)', (_label, change, message) => {
    const data = finalized()
    change(data.books.find((b) => b.id === 8) as MockBook)
    expect(findInvariantViolations(data)).toEqual([])
    expect(findJudgementViolations(data).join('\n')).toContain(`후보 1: ${message}`)
  })
})
