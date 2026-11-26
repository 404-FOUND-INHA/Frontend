import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEED_SESSION_IDS, SEED_ZONES } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import { ApiError, ERROR_CODE } from './ApiError'
import { getObservationDetail, getScanAnalysis, getShelfObservations } from './scanAnalysis'
import { createScanSession, getScanSession } from './scanSessions'

const NOW = Date.parse('2026-11-24T03:00:00Z')

beforeEach(() => {
  resetScanStore({ now: () => NOW })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('ApiError로 거부되어야 합니다')
}

const observationsOf = (sessionId: number) =>
  getScanStore()
    .snapshot()
    .observations.filter((o) => o.sessionId === sessionId)

const keysOf = (value: object) => Object.keys(value).sort()
const sorted = (...keys: string[]) => keys.sort()

// Backend 응답 DTO(ScanAnalysisResponse, ShelfObservationsResponse, ObservationDetailResponse, MatchedBook)의 필드
const COUNT_FIELDS = ['total', 'normal', 'misplaced', 'reviewRequired']
const SHELF_FIELDS = ['shelfId', 'shelfCode', 'shelfWidthCm', 'scanStatus', 'detectedBookCount', 'scannedAt']
const OBSERVATION_FIELDS = [
  'observationId',
  'detectedOrder',
  'xPositionCm',
  'detectedLabelRaw',
  'detectedTitle',
  'detectedClassificationNo',
  'detectedBookSymbol',
  'detectedCopyNumber',
  'analysisStatus',
  'statusReason',
  'matchConfidence',
  'bookId',
  'matchedBook',
]
const BOOK_FIELDS = [
  'bookId',
  'registrationNo',
  'title',
  'callNumber',
  'copyNumber',
  'lifecycleStatus',
  'expectedShelfId',
  'expectedShelfCode',
  'bookWidthCm',
]

describe('분석 결과 접근 함수의 응답', () => {
  it('요약은 저장소의 data를 그대로 돌려주며 Backend 필드를 가진다', async () => {
    const analysis = await getScanAnalysis(SEED_SESSION_IDS.REVIEW_COMPLETE)

    expect(analysis).toStrictEqual(getScanStore().getAnalysis(SEED_SESSION_IDS.REVIEW_COMPLETE))
    expect(keysOf(analysis)).toEqual(sorted('session', 'counts', 'reasonCounts', 'shelves'))
    expect(keysOf(analysis.session)).toEqual(sorted('id', 'status', 'processingStage'))
    expect(keysOf(analysis.counts)).toEqual(sorted(...COUNT_FIELDS))
    for (const shelf of analysis.shelves) expect(keysOf(shelf)).toEqual(sorted(...SHELF_FIELDS, 'counts'))
  })

  it('서가 관측 목록은 저장소의 data를 그대로 돌려주며 Backend 필드를 가진다', async () => {
    const { shelfId } = observationsOf(3)[0]
    const list = await getShelfObservations(3, shelfId)

    expect(list).toStrictEqual(getScanStore().getShelfObservations(3, shelfId))
    expect(keysOf(list)).toEqual(sorted('shelf', 'observations'))
    expect(keysOf(list.shelf)).toEqual(sorted(...SHELF_FIELDS))
    expect(list.observations.length).toBeGreaterThan(0)
    for (const item of list.observations) {
      expect(keysOf(item)).toEqual(sorted(...OBSERVATION_FIELDS, 'candidateCount'))
      if (item.matchedBook) expect(keysOf(item.matchedBook)).toEqual(sorted(...BOOK_FIELDS))
    }
  })

  it('관측 상세는 저장소의 data를 그대로 돌려주며 Backend 필드를 가진다', async () => {
    const duplicate = observationsOf(3).find((o) => o.statusReason === 'DUPLICATE_OBSERVATION')!
    const detail = await getObservationDetail(3, duplicate.id)

    expect(detail).toStrictEqual(getScanStore().getObservation(3, duplicate.id))
    expect(keysOf(detail)).toEqual(
      sorted(
        ...OBSERVATION_FIELDS,
        'detectedShelfId',
        'detectedShelfCode',
        'detectedAt',
        'receivedAt',
        'candidates',
        'duplicateObservations',
      ),
    )
    expect(detail.duplicateObservations).toHaveLength(1)
    expect(keysOf(detail.duplicateObservations[0])).toEqual(
      sorted('observationId', 'detectedShelfId', 'detectedShelfCode', 'detectedOrder'),
    )
  })

  it('건수를 다시 계산하지 않고 저장소 응답의 값을 그대로 전달한다', async () => {
    const response = getScanStore().getAnalysis(2)
    // 관측과 일치하지 않는 값을 응답에 넣어, 접근 계층이 손대지 않는지 확인한다.
    response.counts = { total: 999, normal: 1, misplaced: 2, reviewRequired: 3 }
    vi.spyOn(getScanStore(), 'getAnalysis').mockReturnValue(response)

    expect((await getScanAnalysis(2)).counts).toEqual({ total: 999, normal: 1, misplaced: 2, reviewRequired: 3 })
  })

  it('수신 전 회차와 수신 완료 0건 회차를 구분해 전달한다', async () => {
    const waiting = await getScanAnalysis(SEED_SESSION_IDS.VISION_WAITING)
    const empty = await getScanAnalysis(SEED_SESSION_IDS.REVIEW_NONE)

    expect(waiting.counts.total).toBe(0)
    expect(empty.counts.total).toBe(0)
    for (const shelf of waiting.shelves) {
      expect(shelf).toMatchObject({ scanStatus: 'WAITING', detectedBookCount: null, scannedAt: null })
    }
    for (const shelf of empty.shelves) {
      expect(shelf).toMatchObject({ scanStatus: 'RESULT_RECEIVED', detectedBookCount: 0, scannedAt: null })
    }
    const waitingList = await getShelfObservations(waiting.session.id, waiting.shelves[0].shelfId)
    const emptyList = await getShelfObservations(empty.session.id, empty.shelves[0].shelfId)
    expect(waitingList).toMatchObject({ shelf: { scanStatus: 'WAITING', detectedBookCount: null }, observations: [] })
    expect(emptyList).toMatchObject({ shelf: { scanStatus: 'RESULT_RECEIVED', detectedBookCount: 0 }, observations: [] })
  })

  it('접근 함수로 생성한 회차는 같은 저장소에서 수신 전 상태로 조회된다', async () => {
    const created = await createScanSession({ sessionName: '분석 조회 확인', zone: SEED_ZONES.REFERENCE })

    const analysis = await getScanAnalysis(created.id)

    expect(analysis.session).toEqual({ id: created.id, status: 'IN_PROGRESS', processingStage: 'VISION_WAITING' })
    expect(analysis.shelves.every((s) => s.scanStatus === 'WAITING')).toBe(true)
    expect(await getScanSession(created.id)).toEqual(created)
  })

  it('받은 응답을 바꿔도 다음 조회에 영향이 없다', async () => {
    const first = await getScanAnalysis(2)
    first.counts.total = 0
    first.shelves.pop()

    expect(await getScanAnalysis(2)).toStrictEqual(getScanStore().getAnalysis(2))
    expect((await getScanAnalysis(2)).counts.total).toBe(128)
  })
})

describe('분석 결과 접근 함수의 오류', () => {
  const MISSING = 999_999

  it.each<[string, () => Promise<unknown>, number, string, string]>([
    ['요약: 없는 회차', () => getScanAnalysis(MISSING), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND, '장서점검 회차를 찾을 수 없습니다.'],
    ['목록: 없는 회차', () => getShelfObservations(MISSING, 5), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND, '장서점검 회차를 찾을 수 없습니다.'],
    ['목록: 대상이 아닌 서가', () => getShelfObservations(2, 1), 404, ERROR_CODE.SCAN_SHELF_NOT_IN_SESSION, '해당 회차의 점검 대상 서가가 아닙니다.'],
    ['상세: 없는 회차', () => getObservationDetail(MISSING, 1), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND, '장서점검 회차를 찾을 수 없습니다.'],
    ['상세: 없는 관측', () => getObservationDetail(2, MISSING), 404, ERROR_CODE.SCAN_OBSERVATION_NOT_FOUND, '해당 회차의 관측 도서를 찾을 수 없습니다.'],
    ['요약: 정수가 아닌 ID', () => getScanAnalysis(Number.NaN), 400, ERROR_CODE.INVALID_INPUT, '잘못된 입력입니다.'],
    ['목록: 정수가 아닌 서가 ID', () => getShelfObservations(2, 1.5), 400, ERROR_CODE.INVALID_INPUT, '잘못된 입력입니다.'],
    ['상세: 범위를 벗어난 ID', () => getObservationDetail(MISSING, Number.MAX_SAFE_INTEGER + 1), 400, ERROR_CODE.INVALID_INPUT, '잘못된 입력입니다.'],
    // 요청 차단은 Hook의 일이다. 접근 함수는 저장소 계약대로 0을 없는 ID로 처리한다.
    ['요약: ID 0', () => getScanAnalysis(0), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND, '장서점검 회차를 찾을 수 없습니다.'],
  ])('%s', async (_label, run, status, code, message) => {
    const error = await rejection(run())
    expect(error).toMatchObject({ status, code, message, errors: [] })
  })

  it('호출 즉시 던지지 않고 거부된 Promise로 전달한다', async () => {
    const promise = getScanAnalysis(MISSING)
    expect(promise).toBeInstanceOf(Promise)
    await rejection(promise)
  })
})

describe('지연', () => {
  it.each<[string, () => Promise<unknown>, 'getAnalysis' | 'getShelfObservations' | 'getObservation']>([
    ['getScanAnalysis', () => getScanAnalysis(2), 'getAnalysis'],
    ['getShelfObservations', () => getShelfObservations(2, 5), 'getShelfObservations'],
    ['getObservationDetail', () => getObservationDetail(2, 1), 'getObservation'],
  ])('%s는 테스트가 아닌 환경에서 300ms 뒤에 저장소를 읽는다', async (_label, run, method) => {
    vi.useFakeTimers()
    vi.stubEnv('MODE', 'development')
    const read = vi.spyOn(getScanStore(), method)
    const settled = vi.fn()
    const done = run().then(settled)

    await vi.advanceTimersByTimeAsync(299)
    expect(read).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(read).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledOnce()
  })
})
