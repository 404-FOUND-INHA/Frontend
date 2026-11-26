import { QueryClient, QueryObserver, type QueryKey, type QueryObserverOptions } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { SEED_SESSION_IDS } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import { isRequestableId, scanKeys } from './queryKeys'
import { observationDetailQueryOptions } from './useObservationDetail'
import { scanAnalysisQueryOptions } from './useScanAnalysis'
import { scanSessionQueryOptions } from './useScanSession'
import { shelfObservationsQueryOptions } from './useShelfObservations'

// 실제 훅이 사용하는 옵션을 실제 QueryClient와 Observer 위에서 실행해 검증한다. (React 렌더링 없이 동작)

let queryClient: QueryClient
const unsubscribers: (() => void)[] = []

beforeEach(() => {
  resetScanStore()
  const defaults = appQueryClient.getDefaultOptions()
  queryClient = new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  })
})

afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  expect(queryClient.isFetching()).toBe(0)
  queryClient.clear()
  vi.restoreAllMocks()
})

function observe<TData, TKey extends QueryKey>(options: QueryObserverOptions<TData, Error, TData, TData, TKey>) {
  const observer = new QueryObserver(queryClient, options)
  unsubscribers.push(observer.subscribe(() => {}))
  return observer
}

async function settled<T extends { getCurrentResult(): { fetchStatus: string; status: string } }>(observer: T) {
  await vi.waitFor(() => {
    const { fetchStatus, status } = observer.getCurrentResult()
    expect([fetchStatus, status === 'pending']).toEqual(['idle', false])
  })
  return observer
}

function spyOnStore() {
  const store = getScanStore()
  return {
    analysis: vi.spyOn(store, 'getAnalysis'),
    shelf: vi.spyOn(store, 'getShelfObservations'),
    observation: vi.spyOn(store, 'getObservation'),
  }
}

const observationsOf = (sessionId: number) =>
  getScanStore()
    .snapshot()
    .observations.filter((o) => o.sessionId === sessionId)

const INVALID_IDS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]

describe('분석 쿼리 키', () => {
  it('조회 대상의 식별자를 모두 담는다', () => {
    expect(scanAnalysisQueryOptions(2).queryKey).toEqual(['scan', 'analysis', 2])
    expect(shelfObservationsQueryOptions(2, 5).queryKey).toEqual(['scan', 'shelfObservations', 2, 5])
    expect(observationDetailQueryOptions(2, 5).queryKey).toEqual(['scan', 'observation', 2, 5])
  })

  it('종류, 회차, 서가, 관측이 다르면 서로 다른 키다', () => {
    const keys = [
      scanKeys.session(2),
      scanKeys.analysis(2),
      scanKeys.analysis(3),
      scanKeys.shelfObservations(2, 5),
      scanKeys.shelfObservations(2, 6),
      scanKeys.shelfObservations(3, 5),
      scanKeys.shelfObservations(5, 2),
      scanKeys.observation(2, 5),
      scanKeys.observation(2, 6),
      scanKeys.observation(3, 5),
      scanKeys.observation(5, 2),
    ]
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(keys.length)
  })

  it('기존 회차 상세와 목록 무효화 접두사에 걸리지 않는다', async () => {
    const spies = spyOnStore()
    await settled(observe(scanAnalysisQueryOptions(2)))
    await queryClient.invalidateQueries({ queryKey: scanKeys.sessionLists() })
    await queryClient.invalidateQueries({ queryKey: scanKeys.rooms() })
    await queryClient.invalidateQueries({ queryKey: scanKeys.session(2), exact: true })

    expect(queryClient.getQueryState(scanKeys.analysis(2))?.isInvalidated).toBe(false)
    // 구독 중인 조회는 무효화되면 다시 불러온 뒤 표시가 지워지므로, 호출 횟수로도 확인한다.
    expect(spies.analysis).toHaveBeenCalledExactlyOnceWith(2)
  })
})

describe('조회 활성화 조건', () => {
  it.each(INVALID_IDS)('%s는 요청할 수 없는 ID다', (id) => {
    expect(isRequestableId(id)).toBe(false)
  })

  it.each([1, 100, Number.MAX_SAFE_INTEGER])('%s는 요청할 수 있는 ID다', (id) => {
    expect(isRequestableId(id)).toBe(true)
    expect(scanAnalysisQueryOptions(id).enabled).toBe(true)
    expect(shelfObservationsQueryOptions(id, id).enabled).toBe(true)
    expect(observationDetailQueryOptions(id, id).enabled).toBe(true)
  })

  it.each(INVALID_IDS)('ID가 %s이면 어느 위치든 저장소를 조회하지 않는다', async (bad) => {
    const spies = spyOnStore()
    const observers = [
      observe(scanAnalysisQueryOptions(bad)),
      observe(shelfObservationsQueryOptions(bad, 5)),
      observe(shelfObservationsQueryOptions(2, bad)),
      observe(observationDetailQueryOptions(bad, 1)),
      observe(observationDetailQueryOptions(2, bad)),
    ]
    // 비동기 접근 함수가 호출됐다면 저장소를 읽을 만큼 기다린다.
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (const observer of observers) {
      expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', fetchStatus: 'idle', data: undefined })
    }
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
  })

  it('선택 값이 정해지면 같은 구독이 조회를 시작한다', async () => {
    const spies = spyOnStore()
    const observer = observe(shelfObservationsQueryOptions(2, Number.NaN))
    expect(spies.shelf).not.toHaveBeenCalled()

    observer.setOptions(shelfObservationsQueryOptions(2, 5))
    await settled(observer)

    expect(spies.shelf).toHaveBeenCalledExactlyOnceWith(2, 5)
    expect(observer.getCurrentResult().data?.shelf.shelfId).toBe(5)
  })
})

describe('조회 결과와 캐시', () => {
  it('세 조회는 각자의 저장소 응답을 한 번씩 받아 온다', async () => {
    const first = observationsOf(2)[0]
    const spies = spyOnStore()

    const analysis = await settled(observe(scanAnalysisQueryOptions(2)))
    const list = await settled(observe(shelfObservationsQueryOptions(2, first.shelfId)))
    const detail = await settled(observe(observationDetailQueryOptions(2, first.id)))

    expect(spies.analysis).toHaveBeenCalledExactlyOnceWith(2)
    expect(spies.shelf).toHaveBeenCalledExactlyOnceWith(2, first.shelfId)
    expect(spies.observation).toHaveBeenCalledExactlyOnceWith(2, first.id)
    expect(analysis.getCurrentResult().data?.counts.total).toBe(128)
    expect(list.getCurrentResult().data?.shelf.shelfId).toBe(first.shelfId)
    expect(detail.getCurrentResult().data?.observationId).toBe(first.id)
  })

  it('회차, 서가, 관측이 다른 조회는 데이터가 섞이지 않는다', async () => {
    const [a, b] = [observationsOf(2)[0], observationsOf(2).at(-1)!]
    expect(a.shelfId).not.toBe(b.shelfId)
    const observers = {
      session2: observe(scanAnalysisQueryOptions(2)),
      session3: observe(scanAnalysisQueryOptions(3)),
      shelfA: observe(shelfObservationsQueryOptions(2, a.shelfId)),
      shelfB: observe(shelfObservationsQueryOptions(2, b.shelfId)),
      detailA: observe(observationDetailQueryOptions(2, a.id)),
      detailB: observe(observationDetailQueryOptions(2, b.id)),
    }
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))

    expect(observers.session2.getCurrentResult().data?.session.id).toBe(2)
    expect(observers.session2.getCurrentResult().data?.counts.total).toBe(128)
    expect(observers.session3.getCurrentResult().data?.counts.total).toBe(96)
    expect(observers.shelfA.getCurrentResult().data?.shelf.shelfId).toBe(a.shelfId)
    expect(observers.shelfB.getCurrentResult().data?.shelf.shelfId).toBe(b.shelfId)
    expect(observers.detailA.getCurrentResult().data?.observationId).toBe(a.id)
    expect(observers.detailB.getCurrentResult().data?.observationId).toBe(b.id)
    expect(queryClient.getQueryCache().getAll()).toHaveLength(6)
  })

  it('대상을 바꾸면 이전 대상의 데이터를 보여 주지 않고, 돌아오면 캐시를 다시 쓴다', async () => {
    const spies = spyOnStore()
    const observer = await settled(observe(shelfObservationsQueryOptions(2, 5)))

    observer.setOptions(shelfObservationsQueryOptions(2, 6))
    expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', data: undefined })
    await settled(observer)
    expect(observer.getCurrentResult().data?.shelf.shelfId).toBe(6)

    observer.setOptions(shelfObservationsQueryOptions(2, 5))
    expect(observer.getCurrentResult().data?.shelf.shelfId).toBe(5)
    expect(spies.shelf).toHaveBeenCalledTimes(2) // staleTime 안에서는 다시 조회하지 않는다.
  })

  it('수신 전과 수신 완료 0건을 구분해 보관한다', async () => {
    const waiting = await settled(observe(scanAnalysisQueryOptions(SEED_SESSION_IDS.VISION_WAITING)))
    const empty = await settled(observe(scanAnalysisQueryOptions(SEED_SESSION_IDS.REVIEW_NONE)))

    expect(waiting.getCurrentResult().data?.shelves[0]).toMatchObject({ scanStatus: 'WAITING', detectedBookCount: null })
    expect(empty.getCurrentResult().data?.shelves[0]).toMatchObject({ scanStatus: 'RESULT_RECEIVED', detectedBookCount: 0 })
  })

  it('기존 회차 상세 조회와 같은 회차 ID를 써도 서로 영향을 주지 않는다', async () => {
    const session = await settled(observe(scanSessionQueryOptions(2)))
    const analysis = await settled(observe(scanAnalysisQueryOptions(2)))

    expect(session.getCurrentResult().data).toHaveProperty('sessionName')
    expect(analysis.getCurrentResult().data).toHaveProperty('counts')
  })
})

describe('조회 오류', () => {
  it.each([
    ['없는 회차의 요약', () => observe(scanAnalysisQueryOptions(999_999)), ERROR_CODE.SCAN_SESSION_NOT_FOUND],
    ['대상이 아닌 서가', () => observe(shelfObservationsQueryOptions(2, 1)), ERROR_CODE.SCAN_SHELF_NOT_IN_SESSION],
    ['없는 관측', () => observe(observationDetailQueryOptions(2, 999_999)), ERROR_CODE.SCAN_OBSERVATION_NOT_FOUND],
  ])('%s는 ApiError가 상태 코드·에러 코드와 함께 전달된다', async (_label, start, code) => {
    const observer = start()
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true))

    const { error, data } = observer.getCurrentResult()
    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code })
  })

  it('한 조회의 오류는 다른 조회 결과에 영향이 없다', async () => {
    const ok = await settled(observe(shelfObservationsQueryOptions(2, 5)))
    const failed = await settled(observe(shelfObservationsQueryOptions(2, 1)))

    expect(failed.getCurrentResult().isError).toBe(true)
    expect(ok.getCurrentResult()).toMatchObject({ status: 'success', error: null })
  })

  it('앱 기본 설정의 재시도 1회 뒤에 오류가 전달된다', async () => {
    vi.useFakeTimers()
    try {
      queryClient = new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() })
      const spies = spyOnStore()
      const observer = observe(scanAnalysisQueryOptions(999_999))

      await vi.advanceTimersByTimeAsync(5_000)

      expect(spies.analysis).toHaveBeenCalledTimes(2)
      expect(observer.getCurrentResult().error).toMatchObject({ code: ERROR_CODE.SCAN_SESSION_NOT_FOUND })
    } finally {
      vi.useRealTimers()
    }
  })
})
