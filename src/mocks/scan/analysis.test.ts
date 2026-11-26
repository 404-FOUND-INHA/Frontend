import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { AnalysisCounts, ObservationStatusReason } from '@/types/scan/analysis'
import { findInvariantViolations, findJudgementViolations } from './invariants'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from './seed'
import { createScanStore } from './store'
import type { MockBook, MockData, MockObservation } from './types'

const NOW = Date.parse('2026-11-24T03:00:00Z')
const seedStore = () => createScanStore(createSeedData(), { now: () => NOW })

function expectRejected(run: () => unknown, status: number, code: string): void {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ApiError)
  const error = caught as ApiError
  expect({ status: error.status, code: error.code }).toEqual({ status, code })
}

const counts = (total: number, normal: number, misplaced: number, reviewRequired: number): AnalysisCounts => ({
  total,
  normal,
  misplaced,
  reviewRequired,
})

function sumCounts(list: AnalysisCounts[]): AnalysisCounts {
  return list.reduce(
    (sum, c) => counts(sum.total + c.total, sum.normal + c.normal, sum.misplaced + c.misplaced, sum.reviewRequired + c.reviewRequired),
    counts(0, 0, 0, 0),
  )
}

// ── 기본 시드에 없는 경우(후보, 복수 후보, 파싱값, 3건 이상 중복, 정렬)를 확인하는 테스트 전용 데이터 ──

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

const unidentified = (id: number, statusReason: ObservationStatusReason, overrides: Partial<MockObservation> = {}) =>
  observation(id, { analysisStatus: 'REVIEW_REQUIRED', statusReason, matchConfidence: null, bookId: null, ...overrides })

const duplicate = (id: number, overrides: Partial<MockObservation> = {}) =>
  observation(id, { analysisStatus: 'REVIEW_REQUIRED', statusReason: 'DUPLICATE_OBSERVATION', bookId: 2, ...overrides })

/** 회차 1(서가 1, 2 수신 완료)과 회차 2(수신 완료, 서가 1)로 이루어진 작은 데이터 */
function customData(observations: MockObservation[] = defaultObservations()): MockData {
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
    shelves: [
      { id: 1, shelfCode: 'X-01', zone: 'X', floorNo: 1, widthCm: 90.5, displayOrder: 1, active: true },
      { id: 2, shelfCode: 'X-02', zone: 'X', floorNo: 1, widthCm: null, displayOrder: 2, active: true },
      { id: 3, shelfCode: 'Y-01', zone: 'Y', floorNo: 1, widthCm: 90, displayOrder: 1, active: true },
    ],
    sessions: [session(1), session(2)],
    // 서가 관계를 일부러 ID 역순으로 둔다.
    sessionShelves: [
      { sessionId: 1, shelfId: 2, scanStatus: 'RESULT_RECEIVED' },
      { sessionId: 1, shelfId: 1, scanStatus: 'RESULT_RECEIVED' },
      { sessionId: 2, shelfId: 3, scanStatus: 'RESULT_RECEIVED' },
    ],
    books: [
      book(1),
      book(2),
      book(3, { copyNumber: 'c.2', widthCm: null }),
      book(4, { expectedShelfId: null }),
      book(5, { expectedShelfId: 3 }),
    ],
    observations,
    users: [],
    reviews: [],
  }
}

function defaultObservations(): MockObservation[] {
  return [
    // 파싱값이 있는 라벨 파서 형태의 정상 관측. 저장 순서는 배치 순서와 다르다.
    observation(1, {
      detectedOrder: 5,
      xPositionCm: 12.5,
      detectedLabelRaw: '813.7 김1',
      detectedTitle: '인식한 서명',
      detectedClassificationNo: '813.7',
      detectedBookSymbol: '김1',
      detectedCopyNumber: 'c.1',
      detectedAt: '2026-11-01T10:05:00',
    }),
    unidentified(2, 'AMBIGUOUS_MATCH', {
      detectedOrder: 1,
      detectedAt: '2026-11-01T10:09:00',
      candidates: [
        { rank: 2, reason: 'EXACT_MATCH', bookId: 3 },
        { rank: 1, reason: 'EXACT_MATCH', bookId: 4 },
      ],
    }),
    unidentified(3, 'NO_MATCH', {
      detectedOrder: 3,
      candidates: [
        { rank: 1, reason: 'COPY_MISMATCH', bookId: 3 },
        { rank: 2, reason: 'SYMBOL_ONLY', bookId: 4 },
        { rank: 3, reason: 'CLASSIFICATION_ONLY', bookId: 5 },
      ],
    }),
    // 같은 도서(2)의 관측 3건: 서가 2의 두 건과 서가 1의 한 건
    duplicate(4, { shelfId: 2, detectedOrder: 2 }),
    duplicate(5, { shelfId: 1, detectedOrder: 4 }),
    duplicate(6, { shelfId: 2, detectedOrder: 1 }),
    unidentified(7, 'OCR_FAILED', { detectedOrder: 2 }),
    // 다른 회차에서 같은 도서를 본 관측은 중복이 아니다.
    observation(8, {
      sessionId: 2,
      shelfId: 3,
      detectedOrder: 1,
      analysisStatus: 'MISPLACED',
      statusReason: 'WRONG_SHELF',
      matchConfidence: 0.9123,
      bookId: 2,
    }),
  ]
}

describe('기본 시드의 분석 결과', () => {
  it.each([
    [SEED_SESSION_IDS.VISION_WAITING, counts(0, 0, 0, 0)],
    [SEED_SESSION_IDS.REVIEW_PARTIAL, counts(128, 120, 5, 3)],
    [SEED_SESSION_IDS.REVIEW_COMPLETE, counts(96, 83, 6, 7)],
    [SEED_SESSION_IDS.REVIEW_NONE, counts(0, 0, 0, 0)],
    [SEED_SESSION_IDS.COMPLETED_PENDING, counts(112, 108, 3, 1)],
    [SEED_SESSION_IDS.COMPLETED_READY, counts(104, 99, 3, 2)],
    [SEED_SESSION_IDS.COMPLETED_EMPTY, counts(90, 90, 0, 0)],
  ])('회차 %i의 건수', (id, expected) => {
    expect(seedStore().getAnalysis(id).counts).toEqual(expected)
  })

  it('모든 회차에서 전체 = 상태 합, 서가 합 = 회차 합, 사유 합 = 오배치 + 검토 필요이다', () => {
    const store = seedStore()
    for (const { id, status } of store.snapshot().sessions) {
      const analysis = store.getAnalysis(id)
      const { total, normal, misplaced, reviewRequired } = analysis.counts
      expect(total).toBe(normal + misplaced + reviewRequired)
      for (const shelf of analysis.shelves) {
        expect(shelf.counts.total).toBe(shelf.counts.normal + shelf.counts.misplaced + shelf.counts.reviewRequired)
      }
      expect(sumCounts(analysis.shelves.map((s) => s.counts))).toEqual(analysis.counts)
      const reasons = Object.values(analysis.reasonCounts)
      expect(reasons.every((n) => n > 0)).toBe(true)
      expect(reasons.reduce((a, b) => a + b, 0)).toBe(misplaced + reviewRequired)
      expect(analysis.reasonCounts.WRONG_SHELF ?? 0).toBe(misplaced)
      expect(analysis.session).toEqual({ id, status, processingStage: store.getSession(id).processingStage })
    }
  })

  it('서가 목록의 관측과 상세는 요약의 서가별 건수, 상태와 일치한다', () => {
    const store = seedStore()
    for (const { id } of store.snapshot().sessions) {
      const analysis = store.getAnalysis(id)
      for (const shelf of analysis.shelves) {
        const list = store.getShelfObservations(id, shelf.shelfId)
        const { counts: shelfCounts, ...info } = shelf
        expect(list.shelf).toEqual(info)
        expect(list.observations).toHaveLength(shelfCounts.total)
        expect(list.observations.filter((o) => o.analysisStatus === 'NORMAL')).toHaveLength(shelfCounts.normal)
        expect(list.observations.filter((o) => o.analysisStatus === 'MISPLACED')).toHaveLength(shelfCounts.misplaced)
      }
    }
  })

  it('완료된 이력 회차에도 관측이 있고, 호출할 때마다 같은 결과다', () => {
    const store = seedStore()
    const history = store.snapshot().sessions.filter((s) => s.id >= 100)
    expect(history).toHaveLength(24)
    for (const { id } of history) expect(store.getAnalysis(id).counts.total).toBeGreaterThan(0)
    expect(createSeedData().observations).toEqual(createSeedData().observations)
  })

  it('현재 실행 가능한 OCR 원문 매칭 결과만 담는다 (파싱값·후보·AMBIGUOUS_MATCH 없음)', () => {
    const { observations } = createSeedData()
    for (const o of observations) {
      expect([o.detectedClassificationNo, o.detectedBookSymbol, o.detectedCopyNumber]).toEqual([null, null, null])
      expect(o.candidates).toEqual([])
      expect(o.statusReason).not.toBe('AMBIGUOUS_MATCH')
    }
    // 신뢰도는 원문 완전 일치(1.0) 또는 한 글자가 낀 부분 일치(0.90 + 0.10 / 2)다.
    expect([...new Set(observations.flatMap((o) => o.matchConfidence ?? []))].sort()).toEqual([0.95, 1])
  })

  it('회차 3은 AMBIGUOUS_MATCH를 뺀 모든 판정 사유를 가진다', () => {
    expect(seedStore().getAnalysis(SEED_SESSION_IDS.REVIEW_COMPLETE).reasonCounts).toEqual({
      WRONG_SHELF: 6,
      OCR_FAILED: 1,
      NO_MATCH: 2,
      DUPLICATE_OBSERVATION: 2,
      DISPOSED_BOOK: 1,
      NO_EXPECTED_SHELF: 1,
    })
  })

  it('회차 3의 중복 관측은 서로 다른 서가에서 서로를 가리킨다', () => {
    const store = seedStore()
    const duplicates = store
      .snapshot()
      .observations.filter((o) => o.sessionId === 3 && o.statusReason === 'DUPLICATE_OBSERVATION')
    expect(duplicates).toHaveLength(2)
    const [first, second] = duplicates.map((o) => store.getObservation(3, o.id))
    expect(first.bookId).toBe(second.bookId)
    expect(first.detectedShelfId).not.toBe(second.detectedShelfId)
    expect(first.duplicateObservations).toEqual([
      {
        observationId: second.observationId,
        detectedShelfId: second.detectedShelfId,
        detectedShelfCode: second.detectedShelfCode,
        detectedOrder: second.detectedOrder,
      },
    ])
    expect(second.duplicateObservations.map((d) => d.observationId)).toEqual([first.observationId])
  })
})

describe('수신 전과 관측 0건', () => {
  it('수신 전 회차는 건수 0, 사유 없음, 모든 서가가 WAITING이고 관측 수와 촬영 시각이 null이다', () => {
    const analysis = seedStore().getAnalysis(SEED_SESSION_IDS.VISION_WAITING)
    expect(analysis.session).toEqual({ id: 1, status: 'IN_PROGRESS', processingStage: 'VISION_WAITING' })
    expect(analysis.reasonCounts).toEqual({})
    expect(analysis.shelves).toHaveLength(3)
    for (const shelf of analysis.shelves) {
      expect(shelf).toMatchObject({ scanStatus: 'WAITING', detectedBookCount: null, scannedAt: null, counts: counts(0, 0, 0, 0) })
    }
  })

  it('수신했지만 관측이 없는 회차는 RESULT_RECEIVED, 관측 수 0, 촬영 시각 null이다', () => {
    const analysis = seedStore().getAnalysis(SEED_SESSION_IDS.REVIEW_NONE)
    expect(analysis.session.status).toBe('REVIEW')
    expect(analysis.reasonCounts).toEqual({})
    expect(analysis.shelves).toHaveLength(2)
    for (const shelf of analysis.shelves) {
      expect(shelf).toMatchObject({ scanStatus: 'RESULT_RECEIVED', detectedBookCount: 0, scannedAt: null, counts: counts(0, 0, 0, 0) })
    }
    expect(seedStore().getShelfObservations(4, analysis.shelves[0].shelfId).observations).toEqual([])
  })

  it('회차 3: 관측이 있는 서가, 시각을 보내지 않은 서가, 0건 서가를 구분한다', () => {
    const shelves = seedStore().getAnalysis(3).shelves
    expect(shelves.map((s) => [s.shelfCode, s.detectedBookCount, s.scannedAt === null])).toEqual([
      ['C-01', 35, false],
      ['C-02', 35, false],
      ['C-03', 26, true],
      ['C-04', 0, true],
    ])
    expect(shelves.every((s) => s.scanStatus === 'RESULT_RECEIVED')).toBe(true)
  })

  it('촬영 시각은 해당 서가 관측의 detectedAt 최댓값이다 (null은 무시)', () => {
    const analysis = createScanStore(customData()).getAnalysis(1)
    expect(analysis.shelves.map((s) => [s.shelfId, s.scannedAt])).toEqual([
      [1, '2026-11-01T10:09:00'],
      [2, null],
    ])
  })

  it.each([
    ['소수 초가 없는 시각보다 같은 초의 소수 시각이 늦다', ['2026-11-01T10:00:03.5', '2026-11-01T10:00:03'], '2026-11-01T10:00:03.5'],
    ['자릿수가 달라도 시간 순서로 비교한다', ['2026-11-01T10:00:03.123456', '2026-11-01T10:00:03.5'], '2026-11-01T10:00:03.5'],
    ['마이크로초 차이를 구분한다', ['2026-11-01T10:00:03.100001', '2026-11-01T10:00:03.1', '2026-11-01T10:00:03.100000'], '2026-11-01T10:00:03.100001'],
    ['다음 초는 앞 초의 소수 시각보다 늦다', ['2026-11-01T10:00:04', '2026-11-01T10:00:03.999999'], '2026-11-01T10:00:04'],
  ])('소수 초 촬영 시각: %s', (_label, times, latest) => {
    const data = customData(times.map((detectedAt, index) => unidentified(index + 1, 'OCR_FAILED', { detectedAt })))
    expect(findInvariantViolations(data)).toEqual([])
    const store = createScanStore(data)
    expect(store.getAnalysis(1).shelves[0].scannedAt).toBe(latest)
    expect(store.getShelfObservations(1, 1).shelf.scannedAt).toBe(latest)
    expect(times.map((_, index) => store.getObservation(1, index + 1).detectedAt)).toEqual(times)
  })

  it('새로 생성한 회차는 결과 수신 전 상태다', () => {
    const store = seedStore()
    const before = store.snapshot()
    const created = store.createSession({ sessionName: '새 회차', zone: SEED_ZONES.REFERENCE })
    const analysis = store.getAnalysis(created.id)

    expect(analysis.counts).toEqual(counts(0, 0, 0, 0))
    expect(analysis.shelves.map((s) => [s.scanStatus, s.detectedBookCount, s.scannedAt])).toEqual([
      ['WAITING', null, null],
      ['WAITING', null, null],
    ])
    expect(store.snapshot().observations).toEqual(before.observations)
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })
})

describe('서가 정렬', () => {
  /** 서가 ID 11~15를 회차 1의 대상으로 두고 표시 순서를 지정한다. */
  function shelvesWith(displayOrders: (number | null)[]): MockData {
    const data = customData([])
    data.shelves = displayOrders.map((displayOrder, index) => ({
      id: 11 + index,
      shelfCode: `X-${11 + index}`,
      zone: 'X',
      floorNo: 1,
      widthCm: 90,
      displayOrder,
      active: true,
    }))
    data.sessions = data.sessions.slice(0, 1)
    data.sessionShelves = data.shelves.map((s) => ({ sessionId: 1, shelfId: s.id, scanStatus: 'RESULT_RECEIVED' as const }))
    // 저장 순서가 결과에 영향을 주지 않도록 뒤섞는다.
    data.sessionShelves.reverse()
    return data
  }
  const shelfIdsOf = (data: MockData) => createScanStore(data).getAnalysis(1).shelves.map((s) => s.shelfId)

  it.each<[string, (number | null)[], number[]]>([
    ['표시 순서가 서가 ID 순서와 달라도 표시 순서를 따른다', [3, 1, 2], [12, 13, 11]],
    ['표시 순서가 없는 서가는 뒤에 온다', [null, 2, null, 1], [14, 12, 11, 13]],
    ['표시 순서가 같으면 서가 ID 오름차순이다', [2, 1, 2, 1], [12, 14, 11, 13]],
    ['모두 표시 순서가 없으면 서가 ID 오름차순이다', [null, null, null], [11, 12, 13]],
    ['0과 음수 표시 순서도 null보다 앞이다', [null, 0, -1], [13, 12, 11]],
  ])('%s', (_label, displayOrders, expected) => {
    expect(shelfIdsOf(shelvesWith(displayOrders))).toEqual(expected)
  })

  it('정렬해도 서가별 건수는 해당 서가에 남고, 응답에 displayOrder는 담지 않는다', () => {
    const data = shelvesWith([2, 1])
    data.observations = [unidentified(1, 'OCR_FAILED', { shelfId: 12 })]
    const store = createScanStore(data)
    const { shelves } = store.getAnalysis(1)

    expect(shelves.map((s) => [s.shelfId, s.counts.total, s.detectedBookCount])).toEqual([
      [12, 1, 1],
      [11, 0, 0],
    ])
    expect(Object.keys(shelves[0]).sort()).toEqual(
      ['counts', 'detectedBookCount', 'scanStatus', 'scannedAt', 'shelfCode', 'shelfId', 'shelfWidthCm'],
    )
    expect(store.getShelfObservations(1, 12).shelf).not.toHaveProperty('displayOrder')
  })
})

describe('서가 관측 목록', () => {
  it('detectedOrder 오름차순이며 서가 정보에는 폭(null 포함)이 그대로 담긴다', () => {
    const store = createScanStore(customData())
    const first = store.getShelfObservations(1, 1)
    expect(first.shelf).toEqual({
      shelfId: 1,
      shelfCode: 'X-01',
      shelfWidthCm: 90.5,
      scanStatus: 'RESULT_RECEIVED',
      detectedBookCount: 5,
      scannedAt: '2026-11-01T10:09:00',
    })
    expect(first.observations.map((o) => o.detectedOrder)).toEqual([1, 2, 3, 4, 5])
    expect(store.getShelfObservations(1, 2).shelf.shelfWidthCm).toBeNull()
  })

  it('detectedOrder가 같으면 관측 ID 오름차순이다', () => {
    const store = createScanStore(customData([observation(9, { detectedOrder: 1 }), unidentified(3, 'OCR_FAILED', { detectedOrder: 1 })]))
    expect(store.getShelfObservations(1, 1).observations.map((o) => o.observationId)).toEqual([3, 9])
  })

  it('candidateCount는 관측의 후보 수와 같고 상세의 후보 목록과 일치한다', () => {
    const store = createScanStore(customData())
    const { observations } = store.getShelfObservations(1, 1)
    expect(observations.map((o) => [o.observationId, o.candidateCount])).toEqual([
      [2, 2],
      [7, 0],
      [3, 3],
      [5, 0],
      [1, 0],
    ])
    for (const item of observations) {
      expect(store.getObservation(1, item.observationId).candidates).toHaveLength(item.candidateCount)
    }
  })

  it('항목은 값이 없는 필드도 null로 모두 가진다', () => {
    const item = createScanStore(customData()).getShelfObservations(1, 1).observations[1]
    expect(item).toStrictEqual({
      observationId: 7,
      detectedOrder: 2,
      xPositionCm: null,
      detectedLabelRaw: null,
      detectedTitle: null,
      detectedClassificationNo: null,
      detectedBookSymbol: null,
      detectedCopyNumber: null,
      analysisStatus: 'REVIEW_REQUIRED',
      statusReason: 'OCR_FAILED',
      matchConfidence: null,
      bookId: null,
      matchedBook: null,
      candidateCount: 0,
    })
  })
})

describe('관측 상세', () => {
  it('파싱값과 매칭 도서를 그대로 담고, 상세 전용 필드를 가진다', () => {
    const detail = createScanStore(customData()).getObservation(1, 1)
    expect(detail).toStrictEqual({
      observationId: 1,
      detectedOrder: 5,
      xPositionCm: 12.5,
      detectedLabelRaw: '813.7 김1',
      detectedTitle: '인식한 서명',
      detectedClassificationNo: '813.7',
      detectedBookSymbol: '김1',
      detectedCopyNumber: 'c.1',
      analysisStatus: 'NORMAL',
      statusReason: null,
      matchConfidence: 1,
      bookId: 1,
      matchedBook: {
        bookId: 1,
        registrationNo: 'T1',
        title: '도서 1',
        callNumber: '813.7 김1',
        copyNumber: null,
        lifecycleStatus: 'NORMAL',
        expectedShelfId: 1,
        expectedShelfCode: 'X-01',
        bookWidthCm: 2,
      },
      detectedShelfId: 1,
      detectedShelfCode: 'X-01',
      detectedAt: '2026-11-01T10:05:00',
      receivedAt: '2026-11-01T11:00:00',
      candidates: [],
      duplicateObservations: [],
    })
  })

  it('후보는 순위순이며 도서 정보(null 값 포함)를 가진다', () => {
    const detail = createScanStore(customData()).getObservation(1, 2)
    expect(detail.statusReason).toBe('AMBIGUOUS_MATCH')
    expect(detail.matchedBook).toBeNull()
    expect(detail.candidates.map((c) => [c.rank, c.reason, c.book.bookId])).toEqual([
      [1, 'EXACT_MATCH', 4],
      [2, 'EXACT_MATCH', 3],
    ])
    expect(detail.candidates[0].book).toMatchObject({ expectedShelfId: null, expectedShelfCode: null })
    expect(detail.candidates[1].book).toMatchObject({ copyNumber: 'c.2', bookWidthCm: null })
    expect(detail.duplicateObservations).toEqual([])
  })

  it('중복 관측은 같은 회차의 다른 관측 전부를 서가 ID, 배치 순서로 돌려주고 자신은 제외한다', () => {
    const store = createScanStore(customData())
    expect(store.getObservation(1, 4).duplicateObservations).toEqual([
      { observationId: 5, detectedShelfId: 1, detectedShelfCode: 'X-01', detectedOrder: 4 },
      { observationId: 6, detectedShelfId: 2, detectedShelfCode: 'X-02', detectedOrder: 1 },
    ])
    expect(store.getObservation(1, 5).duplicateObservations.map((d) => d.observationId)).toEqual([6, 4])
  })

  it('중복 관측이 아니면 같은 도서의 다른 관측이 있어도 목록이 비어 있다', () => {
    // 제적 도서는 두 번 관측돼도 사유가 제적으로 남는다.
    const disposed = { analysisStatus: 'REVIEW_REQUIRED' as const, statusReason: 'DISPOSED_BOOK' as const }
    const data = customData([observation(1, disposed), observation(2, disposed)])
    expect(createScanStore(data).getObservation(1, 1).duplicateObservations).toEqual([])
  })
})

describe('조회 오류', () => {
  it('없는 회차는 세 조회 모두 404 SCAN_001이며 서가·관측 확인보다 먼저다', () => {
    const store = seedStore()
    expectRejected(() => store.getAnalysis(999), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
    expectRejected(() => store.getShelfObservations(999, 999), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
    expectRejected(() => store.getObservation(999, 999_999), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
  })

  it('회차 대상이 아닌 서가(다른 자료실, 비활성, 없는 서가)는 404 SCAN_007이다', () => {
    const store = seedStore()
    for (const shelfId of [1, 4, 999]) {
      expectRejected(() => store.getShelfObservations(2, shelfId), 404, ERROR_CODE.SCAN_SHELF_NOT_IN_SESSION)
    }
  })

  it('없는 관측과 다른 회차의 관측은 404 SCAN_008이다', () => {
    const store = seedStore()
    const otherSessions = store.snapshot().observations.find((o) => o.sessionId === 3) as MockObservation
    expectRejected(() => store.getObservation(2, 999_999), 404, ERROR_CODE.SCAN_OBSERVATION_NOT_FOUND)
    expectRejected(() => store.getObservation(2, otherSessions.id), 404, ERROR_CODE.SCAN_OBSERVATION_NOT_FOUND)
    expectRejected(() => store.getObservation(1, otherSessions.id), 404, ERROR_CODE.SCAN_OBSERVATION_NOT_FOUND)
  })

  it.each([
    Number.NaN,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    -(Number.MAX_SAFE_INTEGER + 1),
    1e300,
  ])('안전한 정수가 아닌 ID(%s)는 모든 경로 인자에서 400이며 존재 확인보다 먼저다', (bad) => {
    const store = seedStore()
    expectRejected(() => store.getAnalysis(bad), 400, ERROR_CODE.INVALID_INPUT)
    expectRejected(() => store.getShelfObservations(bad, 1), 400, ERROR_CODE.INVALID_INPUT)
    expectRejected(() => store.getShelfObservations(2, bad), 400, ERROR_CODE.INVALID_INPUT)
    expectRejected(() => store.getShelfObservations(999, bad), 400, ERROR_CODE.INVALID_INPUT)
    expectRejected(() => store.getObservation(bad, 1), 400, ERROR_CODE.INVALID_INPUT)
    expectRejected(() => store.getObservation(2, bad), 400, ERROR_CODE.INVALID_INPUT)
    expectRejected(() => store.getObservation(999, bad), 400, ERROR_CODE.INVALID_INPUT)
  })

  it.each([0, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])(
    '범위 안의 없는 ID(%s)는 404이며 대상에 맞는 코드를 돌려준다',
    (missing) => {
      const store = seedStore()
      expectRejected(() => store.getAnalysis(missing), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
      expectRejected(() => store.getShelfObservations(missing, 5), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
      expectRejected(() => store.getObservation(missing, 1), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
      expectRejected(() => store.getShelfObservations(2, missing), 404, ERROR_CODE.SCAN_SHELF_NOT_IN_SESSION)
      expectRejected(() => store.getObservation(2, missing), 404, ERROR_CODE.SCAN_OBSERVATION_NOT_FOUND)
    },
  )
})

describe('응답 격리', () => {
  it('조회 응답을 바꿔도 저장소와 다음 응답에 영향이 없다', () => {
    const store = createScanStore(customData())
    const before = store.snapshot()
    const read = () => ({
      analysis: store.getAnalysis(1),
      list: store.getShelfObservations(1, 1),
      ambiguous: store.getObservation(1, 2),
      duplicated: store.getObservation(1, 4),
    })
    const expected = structuredClone(read())

    const { analysis, list, ambiguous, duplicated } = read()
    analysis.session.status = 'COMPLETED'
    analysis.counts.total = 0
    analysis.reasonCounts.NO_MATCH = 99
    analysis.shelves[0].counts.normal = 99
    analysis.shelves.pop()
    list.shelf.shelfCode = '변경'
    list.observations[0].analysisStatus = 'NORMAL'
    ;(list.observations[4].matchedBook as { title: string }).title = '변경'
    list.observations.pop()
    ambiguous.candidates[0].book.title = '변경'
    ambiguous.candidates[0].rank = 9
    ambiguous.candidates.pop()
    duplicated.duplicateObservations[0].detectedOrder = 99
    duplicated.duplicateObservations.pop()

    expect(store.snapshot()).toEqual(before)
    expect(read()).toEqual(expected)
  })

  it('snapshot을 바꿔도 분석 결과에 영향이 없다', () => {
    const store = seedStore()
    const snapshot = store.snapshot()
    snapshot.observations.length = 0
    snapshot.books[0].title = '변경'
    expect(store.getAnalysis(2).counts.total).toBe(128)
  })
})

describe('분석 데이터 정합성 검사', () => {
  it('기본 시드와 테스트 전용 데이터(후보·복수 후보 포함)는 위반이 없다', () => {
    expect(findInvariantViolations(createSeedData())).toEqual([])
    // 서가를 넘는 중복과 후보를 포함한다. 관측 1은 도서 1, 관측 8은 다른 회차의 도서 2이다.
    expect(findInvariantViolations(customData())).toEqual([])
  })

  const at = (data: MockData, id: number) => data.observations.find((o) => o.id === id) as MockObservation

  it('기본 시드와 테스트 전용 데이터는 분석 당시 원장 기준의 판정 우선순위를 따른다', () => {
    expect(findJudgementViolations(createSeedData())).toEqual([])
    expect(findJudgementViolations(customData())).toEqual([])
  })

  it.each<[string, Partial<MockBook>, ObservationStatusReason, ObservationStatusReason]>([
    ['중복 관측이 예상 서가 없음보다 우선한다', { expectedShelfId: null }, 'DUPLICATE_OBSERVATION', 'NO_EXPECTED_SHELF'],
    ['제적이 중복 관측보다 우선한다', { lifecycleStatus: 'DISPOSED' }, 'DISPOSED_BOOK', 'DUPLICATE_OBSERVATION'],
    ['제적이 예상 서가 없음보다 우선한다', { lifecycleStatus: 'DISPOSED', expectedShelfId: null }, 'DISPOSED_BOOK', 'NO_EXPECTED_SHELF'],
  ])('판정 우선순위: %s', (_label, overrides, winner, loser) => {
    const twice = (statusReason: ObservationStatusReason) => {
      const same = { analysisStatus: 'REVIEW_REQUIRED' as const, statusReason, bookId: 1 }
      const data = customData([observation(1, same), observation(2, same)])
      Object.assign(data.books[0], overrides)
      return findJudgementViolations(data)
    }
    expect(twice(winner)).toEqual([])
    expect(twice(loser).join('\n')).toContain(`판정 사유는 ${winner}`)
  })

  it.each<[string, (data: MockData) => void, string]>([
    ['상태와 사유 불일치', (d) => (at(d, 1).analysisStatus = 'MISPLACED'), '맞지 않음'],
    ['식별 실패 사유에 도서가 있음', (d) => Object.assign(at(d, 7), { bookId: 3, matchConfidence: 1 }), '식별 도서 유무'],
    ['식별 사유에 도서가 없음', (d) => Object.assign(at(d, 1), { bookId: null, matchConfidence: null }), '식별 도서 유무'],
    ['도서 없이 신뢰도가 있음', (d) => (at(d, 7).matchConfidence = 0.5), '신뢰도는 식별한 도서'],
    ['신뢰도 0', (d) => (at(d, 1).matchConfidence = 0), '0 초과 1 이하'],
    ['신뢰도 1 초과', (d) => (at(d, 1).matchConfidence = 1.2), '0 초과 1 이하'],
    ['인식 실패에 파싱값', (d) => (at(d, 7).detectedBookSymbol = '김1'), '파싱값이 없어야'],
    ['같은 도서 2건인데 중복이 아님', (d) => d.observations.push(observation(20, { detectedOrder: 9 })), '모두 중복이거나 모두 제적'],
    [
      '같은 도서에 중복과 제적이 섞임',
      (d) => Object.assign(at(d, 4), { statusReason: 'DISPOSED_BOOK' }),
      '모두 중복이거나 모두 제적',
    ],
    [
      '같은 도서 2건이 모두 오배치',
      (d) => [4, 5, 6].forEach((id) => Object.assign(at(d, id), { analysisStatus: 'MISPLACED', statusReason: 'WRONG_SHELF' })),
      '모두 중복이거나 모두 제적',
    ],
    ['1건뿐인데 중복', (d) => (d.observations = d.observations.filter((o) => o.id !== 4 && o.id !== 6)), '1건뿐인데 중복'],
    ['후보가 있으면 안 되는 사유', (d) => (at(d, 7).candidates = [{ rank: 1, reason: 'SYMBOL_ONLY', bookId: 3 }]), '후보가 없어야'],
    ['복수 후보가 1건', (d) => at(d, 2).candidates.pop(), '2건 이상'],
    ['복수 후보의 근거', (d) => (at(d, 2).candidates[0].reason = 'SYMBOL_ONLY'), '완전 일치여야'],
    ['일치 없음 후보에 완전 일치', (d) => (at(d, 3).candidates[0].reason = 'EXACT_MATCH'), '완전 일치가 없어야'],
    ['후보 4건', (d) => at(d, 3).candidates.push({ rank: 4, reason: 'CLASSIFICATION_ONLY', bookId: 1 }), '최대 3건'],
    ['후보 순위 비연속', (d) => (at(d, 3).candidates[2].rank = 5), '1부터 연속'],
    ['후보 도서 중복', (d) => (at(d, 3).candidates[1].bookId = 3), '후보 도서가 중복'],
    ['없는 후보 도서', (d) => (at(d, 3).candidates[0].bookId = 999), '존재하지 않는 후보 도서'],
    ['없는 도서', (d) => (at(d, 1).bookId = 999), '존재하지 않는 도서'],
    ['없는 예상 서가', (d) => (d.books[2].expectedShelfId = 999), '존재하지 않는 예상 서가'],
    ['대상이 아닌 서가의 관측', (d) => (at(d, 7).shelfId = 3), '대상 서가가 아님'],
    ['수신 전 서가의 관측', (d) => (d.sessionShelves[1].scanStatus = 'WAITING'), '수신 전 서가'],
    ['배치 순서 중복', (d) => (at(d, 7).detectedOrder = 1), 'detectedOrder가 중복'],
    ['배치 순서 0', (d) => (at(d, 7).detectedOrder = 0), '1 이상의 정수'],
    ['수신 시각이 서로 다름', (d) => (at(d, 7).receivedAt = '2026-11-01T11:00:01'), 'receivedAt이 같아야'],
    ['촬영 시각 형식', (d) => (at(d, 7).detectedAt = '2026-11-01'), 'detectedAt 형식'],
    ['회차 생성 시각 형식', (d) => (d.sessions[0].createdAt = '2026-11-01T09:00:00Z'), 'createdAt 형식'],
    ['관측 ID 중복', (d) => d.observations.push(unidentified(7, 'OCR_FAILED', { detectedOrder: 9 })), '관측 ID가 중복'],
    ['도서 ID 중복', (d) => d.books.push(book(1)), '도서 ID가 중복'],
  ])('위반 검출: %s', (_label, corrupt, message) => {
    const data = customData()
    corrupt(data)
    expect(findInvariantViolations(data).join('\n')).toContain(message)
  })
})

describe('시각 형식', () => {
  const withTime = (time: string) => {
    const data = customData([unidentified(1, 'OCR_FAILED', { detectedAt: time, receivedAt: time })])
    Object.assign(data.sessions[0], { status: 'COMPLETED', startedAt: time, createdAt: time, finalizedAt: time })
    // 확정된 회차에는 미검토 관측이 없어야 한다.
    data.users.push({ id: 1, name: '사서' })
    data.reviews.push({
      id: 1,
      observationId: 1,
      action: 'MARK_UNIDENTIFIED',
      finalStatus: 'UNIDENTIFIED',
      finalBookId: null,
      reviewerId: 1,
      comment: null,
      reviewedAt: time,
    })
    return findInvariantViolations(data)
  }

  it.each(['00', '03.1', '03.12', '03.123', '03.1234', '03.12345', '03.123456'])(
    '타임존 없는 ISO 시각(초 %s)을 허용한다',
    (seconds) => {
      expect(withTime(`2026-11-01T10:00:${seconds}`)).toEqual([])
    },
  )

  it.each([
    '2024-02-29T23:59:59.999999',
    '2000-02-29T00:00:00',
    '2026-12-31T23:59:59',
    '2026-01-01T00:00:00.000001',
  ])('실제 존재하는 날짜·시각 %s을 허용한다', (time) => {
    expect(withTime(time)).toEqual([])
  })

  it.each([
    '2026-11-01',
    '2026-11-01T10:00',
    '2026-11-01 10:00:00',
    '2026-11-01T10:00:00.',
    '2026-11-01T10:00:00.1234567',
    '2026-11-01T10:00:00.12a',
    '2026-11-01T10:00:00,5',
    '2026-11-01T10:00:00Z',
    '2026-11-01T10:00:00.5+09:00',
    ' 2026-11-01T10:00:00',
    '2026-11-01T10:00:00 ',
    '2026-00-01T10:00:00',
    '2026-13-01T10:00:00',
    '2026-11-00T10:00:00',
    '2026-11-31T10:00:00',
    '2026-02-29T10:00:00',
    '2100-02-29T10:00:00',
    '2026-11-01T24:00:00',
    '2026-11-01T99:00:00',
    '2026-11-01T14:60:00',
    '2026-11-01T14:99:00',
    '2026-11-01T14:00:60',
  ])('잘못된 시각 "%s"은 모든 시각 필드에서 위반이다', (time) => {
    const violations = withTime(time).join('\n')
    for (const field of ['startedAt', 'createdAt', 'finalizedAt', 'receivedAt', 'detectedAt', 'reviewedAt']) {
      expect(violations).toContain(`${field} 형식 오류`)
    }
  })
})

describe('분석 이후의 도서 원장 변경', () => {
  it.each<[string, (book: MockBook) => void]>([
    ['예상 서가가 다른 서가로 바뀜', (b) => (b.expectedShelfId = b.expectedShelfId === 1 ? 2 : 1)],
    ['예상 서가가 없어짐', (b) => (b.expectedShelfId = null)],
    ['제적됨', (b) => (b.lifecycleStatus = 'DISPOSED')],
    ['제적이 해제됨', (b) => (b.lifecycleStatus = 'NORMAL')],
  ])('%s: 과거 분석 결과는 유지되고 matchedBook만 현재 정보를 보여 준다', (_label, change) => {
    const original = createScanStore(createSeedData())
    const data = createSeedData()
    data.books.forEach(change)
    const changed = createScanStore(data)

    expect(findInvariantViolations(changed.snapshot())).toEqual([])
    for (const { id } of data.sessions) {
      expect(changed.getAnalysis(id)).toEqual(original.getAnalysis(id))
    }
    for (const o of data.observations.filter((item) => item.sessionId === 3)) {
      const before = original.getObservation(3, o.id)
      const after = changed.getObservation(3, o.id)
      expect({ ...after, matchedBook: null }).toEqual({ ...before, matchedBook: null })
      if (o.bookId !== null) {
        const current = data.books.find((b) => b.id === o.bookId) as MockBook
        expect(after.matchedBook).toMatchObject({
          expectedShelfId: current.expectedShelfId,
          lifecycleStatus: current.lifecycleStatus,
        })
      }
    }
  })

  it('원장이 바뀐 데이터는 당시 기준의 판정 검사에서만 어긋난다', () => {
    const data = customData()
    data.books[0].expectedShelfId = 2
    expect(findInvariantViolations(data)).toEqual([])
    expect(findJudgementViolations(data)).toEqual(['관측 1: 판정 사유는 WRONG_SHELF여야 함 (현재 null)'])
  })

  it.each<[string, Partial<MockBook>, string]>([
    ['정상인데 예상 서가가 다름', { expectedShelfId: 2 }, 'WRONG_SHELF'],
    ['제적 도서인데 다른 사유', { lifecycleStatus: 'DISPOSED' }, 'DISPOSED_BOOK'],
    ['예상 서가가 없는데 정상', { expectedShelfId: null }, 'NO_EXPECTED_SHELF'],
  ])('당시 기준 판정 검사: %s', (_label, overrides, expected) => {
    const data = customData([observation(1)])
    Object.assign(data.books[0], overrides)
    expect(findJudgementViolations(data).join('\n')).toContain(`판정 사유는 ${expected}`)
  })

  it.each<[string, ObservationStatusReason, string]>([
    ['예상 서가인데 오배치', 'WRONG_SHELF', 'null'],
    ['1건뿐인 정상 도서인데 제적', 'DISPOSED_BOOK', 'null'],
  ])('당시 기준 판정 검사: %s', (_label, statusReason, expected) => {
    const analysisStatus = statusReason === 'WRONG_SHELF' ? 'MISPLACED' : 'REVIEW_REQUIRED'
    const data = customData([observation(1, { analysisStatus, statusReason })])
    expect(findJudgementViolations(data).join('\n')).toContain(`판정 사유는 ${expected}`)
  })
})
