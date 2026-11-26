import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { ObservationStatusReason } from '@/types/scan/analysis'
import type { ReviewListParams, ReviewSummary } from '@/types/scan/review'
import { findInvariantViolations, findJudgementViolations } from './invariants'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from './seed'
import { buildSeedAnalysis } from './seedAnalysis'
import { createScanStore, type ScanStore } from './store'
import type { MockBook, MockData, MockObservation, MockReview } from './types'

const seedStore = () => createScanStore(createSeedData(), { now: () => Date.parse('2026-11-24T03:00:00Z') })

function rejection(run: () => unknown): ApiError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('ApiError가 던져져야 합니다')
}

const summary = (totalRequired: number, reviewed: number, remaining: number): ReviewSummary => ({
  totalRequired,
  reviewed,
  remaining,
})

/** 모든 페이지의 항목 */
function allItems(store: ScanStore, sessionId: number, params: ReviewListParams = {}) {
  const first = store.getReviews(sessionId, { ...params, page: 0, size: 100 })
  return Array.from({ length: first.items.totalPages }, (_, page) =>
    store.getReviews(sessionId, { ...params, page, size: 100 }),
  ).flatMap((response) => response.items.content)
}

// ── 테스트 전용 데이터 ──

const book = (id: number, overrides: Partial<MockBook> = {}): MockBook => ({
  id,
  registrationNo: `T${id}`,
  title: `도서 ${id}`,
  callNumber: `813.7 김${id}`,
  copyNumber: null,
  lifecycleStatus: 'NORMAL',
  expectedShelfId: 1,
  widthCm: 2,
  ...overrides,
})

describe('정합성 검사의 시각 비교', () => {
  const DAY = '2026-11-01T'
  /** 확정된 회차의 검토 1건. 수신·검토·확정 시각(시:분:초)을 서로 다르게 지정할 수 있다 */
  const completedWith = ({ received = '11:00:00', reviewed = '14:00:00', finalized = '17:30:00' }) => {
    const data = customData([required(1, { receivedAt: DAY + received })], [review(1, 1, { reviewedAt: DAY + reviewed })])
    Object.assign(data.sessions[0], { status: 'COMPLETED', finalizedAt: DAY + finalized })
    return data
  }

  const SAME_TIME: [string, string][] = [
    ['.100000', '.1'],
    ['.1', '.100000'],
    ['', '.000000'],
    ['.000000', ''],
    ['.12', '.120'],
  ]

  it.each(SAME_TIME)('수신 11:00:00%s, 검토 11:00:00%s은 같은 시각이므로 허용한다', (received, reviewed) => {
    const data = completedWith({ received: `11:00:00${received}`, reviewed: `11:00:00${reviewed}` })
    const original = structuredClone(data)
    expect(findInvariantViolations(data)).toEqual([])
    expect(data).toEqual(original)
  })

  it.each(SAME_TIME)('검토 17:30:00%s, 확정 17:30:00%s은 같은 시각이므로 허용한다', (reviewed, finalized) => {
    const data = completedWith({ reviewed: `17:30:00${reviewed}`, finalized: `17:30:00${finalized}` })
    expect(findInvariantViolations(data)).toEqual([])
  })

  it.each([
    ['11:00:00', '10:59:59'],
    ['11:00:00', '10:59:59.999999'],
    ['11:00:00.000001', '11:00:00'],
    ['11:00:00.1', '11:00:00.099999'],
    ['11:00:00.100001', '11:00:00.1'],
  ])('수신 %s보다 이른 검토 %s은 거부한다', (received, reviewed) => {
    expect(findInvariantViolations(completedWith({ received, reviewed }))).toEqual(['검토 1: 결과 수신 전에 검토할 수 없음'])
  })

  it.each([
    ['17:30:00', '17:30:01'],
    ['17:30:00', '17:30:00.000001'],
    ['17:30:00.1', '17:30:00.100001'],
    ['17:30:00.099999', '17:30:00.1'],
  ])('확정 %s보다 늦은 검토 %s은 거부한다', (finalized, reviewed) => {
    expect(findInvariantViolations(completedWith({ reviewed, finalized }))).toEqual(['검토 1: 확정 이후에 검토할 수 없음'])
  })

  it.each([
    ['11:00:00.1', '11:00:00.100001', '11:00:00.100001'],
    ['11:00:00.100000', '11:00:00.100001', '11:00:00.100002'],
  ])('수신 %s ≤ 검토 %s ≤ 확정 %s은 허용한다', (received, reviewed, finalized) => {
    expect(findInvariantViolations(completedWith({ received, reviewed, finalized }))).toEqual([])
  })

  it.each<[string, Parameters<typeof completedWith>[0], string]>([
    ['검토 시각 14:99:00', { reviewed: '14:99:00' }, '검토 1: reviewedAt 형식 오류'],
    ['수신 시각 11:00:60', { received: '11:00:60' }, '관측 1: receivedAt 형식 오류'],
    ['확정 시각 24:00:00', { finalized: '24:00:00' }, '회차 1: finalizedAt 형식 오류'],
  ])('유효하지 않은 %s은 그 필드의 위반 하나로만 알린다', (_label, times, message) => {
    expect(findInvariantViolations(completedWith(times))).toEqual([message])
  })

  it.each([
    ['.1', '.100000'],
    ['', '.000000'],
  ])('같은 회차의 수신 시각 11:00:00%s과 11:00:00%s은 같다', (first, second) => {
    const data = customData([
      observation(1, { receivedAt: `${DAY}11:00:00${first}` }),
      observation(2, { receivedAt: `${DAY}11:00:00${second}`, bookId: 2 }),
    ])
    expect(findInvariantViolations(data)).toEqual([])
  })

  it('같은 회차의 수신 시각이 마이크로초만 달라도 위반이다', () => {
    const data = customData([
      observation(1, { receivedAt: `${DAY}11:00:00.1` }),
      observation(2, { receivedAt: `${DAY}11:00:00.100001`, bookId: 2 }),
    ])
    expect(findInvariantViolations(data)).toEqual(['관측 2: 같은 회차의 관측은 receivedAt이 같아야 함'])
  })
})

const observation = (id: number, overrides: Partial<MockObservation> = {}): MockObservation => ({
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
  matchConfidence: 1,
  bookId: 1,
  candidates: [],
  ...overrides,
})

/** 도서를 식별하지 못한 검토 필요 관측 */
const required = (id: number, overrides: Partial<MockObservation> = {}, statusReason: ObservationStatusReason = 'OCR_FAILED') =>
  observation(id, { analysisStatus: 'REVIEW_REQUIRED', statusReason, matchConfidence: null, bookId: null, ...overrides })

const review = (id: number, observationId: number, overrides: Partial<MockReview> = {}): MockReview => ({
  id,
  observationId,
  action: 'MARK_UNIDENTIFIED',
  finalStatus: 'UNIDENTIFIED',
  finalBookId: null,
  reviewerId: 7,
  comment: null,
  reviewedAt: '2026-11-01T14:00:00',
  ...overrides,
})

const identified = (id: number, observationId: number, finalBookId: number, finalStatus: 'NORMAL' | 'MISPLACED' = 'NORMAL') =>
  review(id, observationId, { action: 'IDENTIFY_BOOK', finalStatus, finalBookId })

/** 회차 1(서가 1, 2)과 회차 2(서가 3). 모두 수신 완료한 REVIEW 상태 */
function customData(observations: MockObservation[], reviews: MockReview[] = []): MockData {
  const session = (id: number) => ({
    id,
    sessionName: `회차 ${id}`,
    status: 'REVIEW' as const,
    zone: id === 1 ? 'X' : 'Y',
    plannedStartDate: null,
    startedAt: '2026-11-01T09:00:00',
    finalizedAt: null,
    createdAt: '2026-11-01T09:00:00',
  })
  return {
    shelves: [1, 2, 3].map((id) => ({
      id,
      shelfCode: `S-${id}`,
      zone: id === 3 ? 'Y' : 'X',
      floorNo: 1,
      widthCm: 90,
      displayOrder: 4 - id, // 표시 순서는 서가 ID의 역순
      active: true,
    })),
    sessions: [session(1), session(2)],
    sessionShelves: [
      { sessionId: 1, shelfId: 1, scanStatus: 'RESULT_RECEIVED' },
      { sessionId: 1, shelfId: 2, scanStatus: 'RESULT_RECEIVED' },
      { sessionId: 2, shelfId: 3, scanStatus: 'RESULT_RECEIVED' },
    ],
    books: [book(1), book(2), book(3, { expectedShelfId: 2 }), book(4, { expectedShelfId: null })],
    observations,
    users: [{ id: 7, name: '검토 사서' }],
    reviews,
  }
}

const many = (count: number) => customData(Array.from({ length: count }, (_, i) => required(i + 1)))

describe('검토 시드', () => {
  it.each([
    [SEED_SESSION_IDS.VISION_WAITING, summary(0, 0, 0)],
    [SEED_SESSION_IDS.REVIEW_PARTIAL, summary(3, 2, 1)],
    [SEED_SESSION_IDS.REVIEW_COMPLETE, summary(7, 7, 0)],
    [SEED_SESSION_IDS.REVIEW_NONE, summary(0, 0, 0)],
    [SEED_SESSION_IDS.COMPLETED_PENDING, summary(1, 1, 0)],
    [SEED_SESSION_IDS.COMPLETED_READY, summary(2, 2, 0)],
    [SEED_SESSION_IDS.COMPLETED_EMPTY, summary(0, 0, 0)],
  ])('회차 %i의 검토 현황', (id, expected) => {
    expect(seedStore().getReviews(id).summary).toEqual(expected)
  })

  it('저장 데이터 규칙과 당시 원장 기준의 판정을 지킨다', () => {
    const data = createSeedData()
    expect(findInvariantViolations(data)).toEqual([])
    expect(findJudgementViolations(data)).toEqual([])
    expect(createSeedData()).toEqual(data)
  })

  it('모든 회차에서 필수 검토는 자동 분석의 REVIEW_REQUIRED 관측이며 오배치는 포함하지 않는다', () => {
    const store = seedStore()
    const { observations } = store.snapshot()
    for (const { id } of store.snapshot().sessions) {
      const response = store.getReviews(id)
      const items = allItems(store, id)
      expect(response.summary.totalRequired).toBe(store.getAnalysis(id).counts.reviewRequired)
      expect(items.map((i) => i.observationId).sort((a, b) => a - b)).toEqual(
        observations
          .filter((o) => o.sessionId === id && o.analysisStatus === 'REVIEW_REQUIRED')
          .map((o) => o.id),
      )
      expect(response.summary.reviewed).toBe(items.filter((i) => i.review !== null).length)
      expect(response.summary.remaining).toBe(items.filter((i) => i.review === null).length)
    }
  })

  it('완료된 회차는 이력 회차를 포함해 미처리 검토가 없다', () => {
    const store = seedStore()
    const completed = store.snapshot().sessions.filter((s) => s.status === 'COMPLETED')
    expect(completed).toHaveLength(27)
    expect(completed.every((s) => store.getReviews(s.id).summary.remaining === 0)).toBe(true)
    expect(completed.some((s) => s.id >= 100 && store.getReviews(s.id).summary.totalRequired > 0)).toBe(true)
  })

  it('회차 2는 중복 하나를 확정하고 하나를 제외하며 일치 없음 1건이 남는다', () => {
    const items = allItems(seedStore(), 2)
    const view = items.map((i) => [i.statusReason, i.review?.action ?? null, i.review?.finalStatus ?? null])
    expect(view).toHaveLength(3)
    expect(view).toEqual(
      expect.arrayContaining([
        ['NO_MATCH', null, null],
        ['DUPLICATE_OBSERVATION', 'IDENTIFY_BOOK', 'NORMAL'],
        ['DUPLICATE_OBSERVATION', 'EXCLUDE', 'EXCLUDED'],
      ]),
    )
  })

  it('회차 3은 모든 조치와 최종 판정을 가진다', () => {
    const reviews = allItems(seedStore(), 3).map((i) => i.review!)
    const tally = (values: string[]) =>
      values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {})
    expect(tally(reviews.map((r) => r.finalStatus))).toEqual({ NORMAL: 3, MISPLACED: 1, UNIDENTIFIED: 2, EXCLUDED: 1 })
    expect(tally(reviews.map((r) => r.action))).toEqual({ IDENTIFY_BOOK: 4, MARK_UNIDENTIFIED: 2, EXCLUDE: 1 })
    expect(reviews.every((r) => r.reviewerName === '김사서')).toBe(true)
  })

  it('자동 분석 시드의 관측은 바꾸지 않고, 도서는 소재불명 1권 지정과 검토용 도서 추가만 한다', () => {
    const data = createSeedData()
    const analysis = buildSeedAnalysis(data)
    expect(data.observations).toEqual(analysis.observations)

    const original = data.books.slice(0, analysis.books.length)
    const changed = original.filter((b, i) => JSON.stringify(b) !== JSON.stringify(analysis.books[i]))
    expect(changed).toHaveLength(1)
    expect(changed[0]).toEqual({ ...analysis.books[changed[0].id - 1], lifecycleStatus: 'MISSING' })
    // 소재불명으로 둔 도서는 회차 2의 정상 관측에만 나온다.
    const seen = data.observations.filter((o) => o.bookId === changed[0].id)
    expect(seen.map((o) => [o.sessionId, o.analysisStatus])).toEqual([[2, 'NORMAL']])

    const added = data.books.slice(analysis.books.length)
    expect(added).toHaveLength(1)
    expect(added[0].lifecycleStatus).toBe('MISSING')
    expect(data.observations.some((o) => o.bookId === added[0].id)).toBe(false)
    expect(data.reviews.filter((r) => r.finalBookId === added[0].id)).toHaveLength(1)
  })

  it('새로 생성한 회차에는 검토 대상이 없다', () => {
    const store = seedStore()
    const created = store.createSession({ sessionName: '새 회차', zone: SEED_ZONES.REFERENCE })
    expect(store.getReviews(created.id)).toEqual({
      summary: summary(0, 0, 0),
      items: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 },
    })
  })
})

describe('집계', () => {
  const data = () =>
    customData(
      [
        observation(1),
        observation(2, { analysisStatus: 'MISPLACED', statusReason: 'WRONG_SHELF', bookId: 3 }),
        required(3),
        required(4),
        required(5),
        required(6),
        required(7, { sessionId: 2, shelfId: 3, detectedOrder: 1 }),
      ],
      [review(1, 3), review(2, 4, { action: 'EXCLUDE', finalStatus: 'EXCLUDED' }), identified(3, 5, 2), review(4, 7)],
    )

  it('검토 필요 관측만 대상이고, 식별 불가·제외도 검토 완료다', () => {
    const response = createScanStore(data()).getReviews(1)
    expect(response.summary).toEqual(summary(4, 3, 1))
    expect(response.items.content.map((i) => i.observationId)).toEqual([3, 4, 5, 6])
  })

  it('다른 회차의 관측과 검토는 섞이지 않는다', () => {
    expect(createScanStore(data()).getReviews(2).summary).toEqual(summary(1, 1, 0))
  })

  it('이후에 도서 원장이 바뀌어도 저장된 검토 판정과 집계는 유지하고 도서 정보만 현재 값이다', () => {
    const changed = data()
    Object.assign(changed.books[1], { title: '바뀐 서명', expectedShelfId: null, lifecycleStatus: 'DISPOSED' })
    const response = createScanStore(changed).getReviews(1)

    expect(response.summary).toEqual(summary(4, 3, 1))
    expect(response.items.content[2].review).toMatchObject({ finalStatus: 'NORMAL', finalBook: { title: '바뀐 서명' } })
    expect(findInvariantViolations(changed)).toEqual([])
    expect(findJudgementViolations(changed)).toContain('검토 3: 최종 판정은 MISPLACED여야 함 (현재 NORMAL)')
  })
})

describe('응답 형태', () => {
  it('Backend의 필드를 가지며 값이 없는 필드도 null로 담는다', () => {
    const response = createScanStore(
      customData([required(1, { detectedLabelRaw: '원문', detectedTitle: '서명' }, 'NO_MATCH')]),
    ).getReviews(1)

    expect(response).toStrictEqual({
      summary: summary(1, 0, 1),
      items: {
        content: [
          {
            observationId: 1,
            shelfId: 1,
            shelfCode: 'S-1',
            detectedOrder: 1,
            detectedLabelRaw: '원문',
            detectedTitle: '서명',
            statusReason: 'NO_MATCH',
            autoMatchedBook: null,
            candidateCount: 0,
            review: null,
          },
        ],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      },
    })
  })

  it('자동 매칭 도서, 확정 도서, 후보 수, 검토 정보를 담는다', () => {
    const data = customData(
      [
        required(1, { bookId: 4, matchConfidence: 1 }, 'NO_EXPECTED_SHELF'),
        required(2, { candidates: [{ rank: 1, reason: 'SYMBOL_ONLY', bookId: 2 }] }, 'NO_MATCH'),
      ],
      [identified(1, 1, 4, 'MISPLACED'), { ...identified(2, 2, 3, 'MISPLACED'), comment: '확인함' }],
    )
    const [first, second] = createScanStore(data).getReviews(1).items.content
    const brief = (id: number) => ({ bookId: id, registrationNo: `T${id}`, title: `도서 ${id}`, callNumber: `813.7 김${id}` })

    expect(first.autoMatchedBook).toStrictEqual(brief(4))
    expect(second.autoMatchedBook).toBeNull()
    expect(second.candidateCount).toBe(1)
    expect(second.review).toStrictEqual({
      reviewId: 2,
      action: 'IDENTIFY_BOOK',
      finalStatus: 'MISPLACED',
      finalBook: brief(3),
      comment: '확인함',
      reviewerId: 7,
      reviewerName: '검토 사서',
      reviewedAt: '2026-11-01T14:00:00',
    })
  })

  it('검토자를 찾을 수 없으면 이름은 null이다', () => {
    const data = customData([required(1)], [review(1, 1)])
    data.users = []
    expect(createScanStore(data).getReviews(1).items.content[0].review?.reviewerName).toBeNull()
  })

  it('응답을 바꿔도 저장소와 다음 응답에 영향이 없다', () => {
    const store = createScanStore(customData([required(1)], [identified(1, 1, 2)]))
    const before = store.snapshot()
    const response = store.getReviews(1)
    const expected = structuredClone(response)
    response.summary.remaining = 9
    response.items.content[0].review!.finalBook!.title = '변경'
    response.items.content[0].review!.finalStatus = 'EXCLUDED'
    response.items.content.pop()

    expect(store.snapshot()).toEqual(before)
    expect(store.getReviews(1)).toEqual(expected)
  })
})

describe('정렬, 필터, 페이지', () => {
  /** 저장 순서와 표시 순서가 결과 순서와 다른 데이터 */
  const data = () =>
    customData(
      [
        required(10, { shelfId: 2, detectedOrder: 1 }),
        required(11, { shelfId: 1, detectedOrder: 3 }),
        required(12, { shelfId: 1, detectedOrder: 2 }),
        required(9, { shelfId: 2, detectedOrder: 1 }),
        required(13, { shelfId: 2, detectedOrder: 4 }),
      ],
      [review(1, 12), review(2, 9)],
    )
  const ids = (params: ReviewListParams = {}) =>
    createScanStore(data()).getReviews(1, params).items.content.map((i) => i.observationId)

  it('서가 ID(표시 순서가 아님), 배치 순서, 관측 ID 순이다', () => {
    expect(ids()).toEqual([12, 11, 9, 10, 13])
  })

  it.each<[string, ReviewListParams, number[]]>([
    ['서가', { shelfId: 2 }, [9, 10, 13]],
    ['검토 완료', { reviewed: true }, [12, 9]],
    ['미처리', { reviewed: false }, [11, 10, 13]],
    ['서가와 미처리', { shelfId: 2, reviewed: false }, [10, 13]],
    ['대상이 아닌 서가', { shelfId: 3 }, []],
    ['없는 서가', { shelfId: 999 }, []],
  ])('%s 필터를 적용하며 summary는 회차 전체다', (_label, params, expected) => {
    const response = createScanStore(data()).getReviews(1, params)
    expect(response.items.content.map((i) => i.observationId)).toEqual(expected)
    expect(response.items.totalElements).toBe(expected.length)
    expect(response.summary).toEqual(summary(5, 2, 3))
  })

  it('필터를 적용한 뒤 페이지를 나누고, summary는 페이지와 무관하다', () => {
    const store = createScanStore(data())
    const page = (n: number) => store.getReviews(1, { reviewed: false, page: n, size: 2 })

    expect(page(0).items).toMatchObject({ page: 0, size: 2, totalElements: 3, totalPages: 2 })
    expect(page(0).items.content.map((i) => i.observationId)).toEqual([11, 10])
    expect(page(1).items.content.map((i) => i.observationId)).toEqual([13])
    expect(page(2).items).toMatchObject({ page: 2, content: [], totalElements: 3, totalPages: 2 })
    for (const n of [0, 1, 2]) expect(page(n).summary).toEqual(summary(5, 2, 3))
  })

  it('page 기본값은 0, size 기본값은 20이고 최대 100이다', () => {
    const store = createScanStore(many(105))
    expect(store.getReviews(1).items).toMatchObject({ page: 0, size: 20, totalElements: 105, totalPages: 6 })
    expect(store.getReviews(1).items.content).toHaveLength(20)
    expect(store.getReviews(1, { size: 1000 }).items).toMatchObject({ size: 100, totalPages: 2 })
    expect(store.getReviews(1, { size: 1000 }).items.content).toHaveLength(100)
    expect(store.getReviews(1, { size: 100, page: 1 }).items.content).toHaveLength(5)
  })

  it.each([
    [{ page: -3 }, 0, 20],
    [{ size: 0 }, 0, 1],
    [{ size: -5 }, 0, 1],
  ])('범위를 벗어난 %o은 오류 없이 보정한다', (params, page, size) => {
    expect(createScanStore(many(3)).getReviews(1, params).items).toMatchObject({ page, size })
  })
})

describe('조회 오류', () => {
  const MISSING = 999_999

  it.each<[string, number, ReviewListParams]>([
    ['회차 ID가 정수가 아님', 1.5, {}],
    ['회차 ID가 안전한 정수 범위 밖', Number.MAX_SAFE_INTEGER + 1, {}],
    ['서가 ID가 정수가 아님', MISSING, { shelfId: Number.NaN }],
    ['page가 정수가 아님', MISSING, { page: 0.5 }],
    ['page가 int 범위 밖', MISSING, { page: 2_147_483_648 }],
    ['size가 int 범위 밖', MISSING, { size: -2_147_483_649 }],
    ['reviewed가 boolean이 아님', MISSING, { reviewed: 'true' as unknown as boolean }],
  ])('%s: 400이며 회차 확인보다 먼저다', (_label, sessionId, params) => {
    expect(rejection(() => seedStore().getReviews(sessionId, params))).toMatchObject({
      status: 400,
      code: ERROR_CODE.INVALID_INPUT,
    })
  })

  it.each([MISSING, 0, -1])('없는 회차(%i)는 404 SCAN_001이다', (id) => {
    expect(rejection(() => seedStore().getReviews(id))).toMatchObject({
      status: 404,
      code: ERROR_CODE.SCAN_SESSION_NOT_FOUND,
    })
  })

  it('page * size가 int 범위를 넘으면 400이고, 회차 확인은 그보다 먼저다', () => {
    const params = { page: 100_000_000, size: 100 }
    expect(rejection(() => seedStore().getReviews(2, params))).toMatchObject({
      status: 400,
      code: ERROR_CODE.INVALID_INPUT,
      message: 'page 값이 너무 큽니다.',
    })
    expect(rejection(() => seedStore().getReviews(MISSING, params)).code).toBe(ERROR_CODE.SCAN_SESSION_NOT_FOUND)
  })
})

describe('검토 정합성 검사', () => {
  const data = () =>
    customData(
      [
        observation(1),
        observation(2, { analysisStatus: 'MISPLACED', statusReason: 'WRONG_SHELF', bookId: 3 }),
        required(3),
        required(4),
        required(5, { sessionId: 2, shelfId: 3, detectedOrder: 1 }),
      ],
      [identified(1, 3, 2), review(2, 4), review(3, 5)],
    )
  const complete = (d: MockData, id: number) =>
    Object.assign(d.sessions[id - 1], { status: 'COMPLETED', finalizedAt: '2026-11-02T17:00:00' })

  it('규칙을 지키는 데이터는 위반이 없다 (확정된 회차 포함)', () => {
    const valid = data()
    complete(valid, 1)
    expect(findInvariantViolations(valid)).toEqual([])
  })

  it('다른 회차에서 확정하거나 자동 확인한 도서는 다시 확정할 수 있다', () => {
    const valid = data()
    Object.assign(valid.reviews[2], identified(3, 5, 1, 'MISPLACED'))
    expect(findInvariantViolations(valid)).toEqual([])
    Object.assign(valid.reviews[2], identified(3, 5, 2, 'MISPLACED'))
    expect(findInvariantViolations(valid)).toEqual([])
  })

  it.each<[string, (d: MockData) => void, string]>([
    ['없는 관측', (d) => (d.reviews[1].observationId = 999), '존재하지 않는 관측'],
    ['관측당 검토 2건', (d) => d.reviews.push(review(4, 4)), '같은 관측에 검토가 중복'],
    ['검토 ID 중복', (d) => (d.reviews[1].id = 1), '검토 ID가 중복'],
    ['사용자 ID 중복', (d) => d.users.push({ id: 7, name: '중복' }), '사용자 ID가 중복'],
    ['없는 검토자', (d) => (d.reviews[1].reviewerId = 999), '존재하지 않는 검토자'],
    ['정상 관측의 검토', (d) => d.reviews.push(review(4, 1)), '검토 필요 관측이 아님'],
    ['오배치 관측의 검토', (d) => d.reviews.push(review(4, 2)), '검토 필요 관측이 아님'],
    ['수신 전 회차의 검토', (d) => (d.sessions[0].status = 'IN_PROGRESS'), '수신 전 회차에는 검토'],
    ['도서 확정인데 도서 없음', (d) => (d.reviews[0].finalBookId = null), '반드시 있어야 함'],
    ['식별 불가인데 도서 있음', (d) => (d.reviews[1].finalBookId = 4), '반드시 있어야 함'],
    ['도서 확정의 판정', (d) => (d.reviews[0].finalStatus = 'EXCLUDED'), '맞지 않음'],
    ['식별 불가의 판정', (d) => (d.reviews[1].finalStatus = 'EXCLUDED'), '맞지 않음'],
    ['제외의 판정', (d) => Object.assign(d.reviews[1], { action: 'EXCLUDE' }), '맞지 않음'],
    ['없는 확정 도서', (d) => (d.reviews[0].finalBookId = 999), '존재하지 않는 도서'],
    ['자동 정상 관측의 도서를 확정', (d) => (d.reviews[0].finalBookId = 1), '이미 확정된 도서 1'],
    ['자동 오배치 관측의 도서를 확정', (d) => (d.reviews[0].finalBookId = 3), '이미 확정된 도서 3'],
    ['같은 도서를 두 검토에 확정', (d) => Object.assign(d.reviews[1], identified(2, 4, 2)), '이미 확정된 도서 2'],
    ['의견이 빈 문자열', (d) => (d.reviews[0].comment = ''), '의견은'],
    ['의견에 앞뒤 공백', (d) => (d.reviews[0].comment = ' 의견 '), '의견은'],
    ['의견 1001자', (d) => (d.reviews[0].comment = '가'.repeat(1001)), '의견은'],
    ['검토 시각 형식', (d) => (d.reviews[0].reviewedAt = '2026-11-01'), 'reviewedAt 형식'],
    ['수신 전 검토 시각', (d) => (d.reviews[0].reviewedAt = '2026-11-01T10:59:59'), '결과 수신 전'],
    [
      '확정 이후 검토 시각',
      (d) => {
        complete(d, 1)
        d.reviews[0].reviewedAt = '2026-11-02T17:00:01'
      },
      '확정 이후',
    ],
    [
      '확정된 회차의 미검토',
      (d) => {
        complete(d, 1)
        d.reviews = d.reviews.filter((r) => r.observationId !== 4)
      },
      '미검토 관측이 있음 (관측 4)',
    ],
  ])('위반 검출: %s', (_label, corrupt, message) => {
    const broken = data()
    corrupt(broken)
    expect(findInvariantViolations(broken).join('\n')).toContain(message)
  })

  it.each<[string, number, 'NORMAL' | 'MISPLACED', 'NORMAL' | 'MISPLACED']>([
    ['예상 서가 = 관측 서가', 1, 'NORMAL', 'MISPLACED'],
    ['다른 예상 서가', 3, 'MISPLACED', 'NORMAL'],
    ['예상 서가 없음', 4, 'MISPLACED', 'NORMAL'],
  ])('당시 기준 판정: %s', (_label, bookId, right, wrong) => {
    const withStatus = (status: 'NORMAL' | 'MISPLACED') =>
      findJudgementViolations(customData([required(1)], [identified(1, 1, bookId, status)]))
    expect(withStatus(right)).toEqual([])
    expect(withStatus(wrong)).toEqual([`검토 1: 최종 판정은 ${right}여야 함 (현재 ${wrong})`])
  })
})
