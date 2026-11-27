import { hashKey, InfiniteQueryObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_CODE } from '@/api/ApiError'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import type { MissingCandidateListParams } from '@/types/scan/missingCandidate'
import { scanKeys } from './queryKeys'
import { disposalCandidatesInfiniteQueryOptions } from './useDisposalCandidates'
import { missingCandidatesInfiniteQueryOptions } from './useMissingCandidates'
import { loadMoreScanSessions } from './useScanSessions'

let queryClient: QueryClient
const unsubscribers: (() => void)[] = []

beforeEach(() => {
  resetScanStore({ now: () => Date.parse('2026-11-26T03:00:00Z') })
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

const INVALID_IDS = [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]

type Observed<T> = { subscribe(listener: () => void): () => void; getCurrentResult(): T }

async function settled<T extends { status: string; fetchStatus: string }>(observer: Observed<T>): Promise<T> {
  unsubscribers.push(observer.subscribe(() => {}))
  await vi.waitFor(() => {
    expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    expect(observer.getCurrentResult().status).not.toBe('pending')
  })
  return observer.getCurrentResult()
}

const missing = (sessionId: number, params?: Omit<MissingCandidateListParams, 'page'>) =>
  new InfiniteQueryObserver(queryClient, missingCandidatesInfiniteQueryOptions(sessionId, params))
const disposal = (sessionId: number, size?: number) =>
  new InfiniteQueryObserver(queryClient, disposalCandidatesInfiniteQueryOptions(sessionId, size))

describe('후보 조회 쿼리 키', () => {
  it('생략한 조건은 기본값으로 채우고, 회차와 조건이 다르면 다른 키다', () => {
    expect(scanKeys.missingCandidates(5)).toEqual(['scan', 'missingCandidates', 5, { status: undefined, size: 20 }])
    expect(scanKeys.disposalCandidates(5)).toEqual(['scan', 'disposalCandidates', 5, { size: 20 }])
    expect(hashKey(scanKeys.missingCandidates(5, {}))).toBe(hashKey(scanKeys.missingCandidates(5, { size: 20 })))

    const keys = [
      scanKeys.missingCandidates(5),
      scanKeys.missingCandidates(6),
      scanKeys.missingCandidates(5, { status: 'PENDING' }),
      scanKeys.missingCandidates(5, { size: 2 }),
      scanKeys.disposalCandidates(5),
      scanKeys.disposalCandidates(6),
      scanKeys.disposalCandidates(5, 2),
      scanKeys.reviews(5),
    ]
    expect(new Set(keys.map((key) => hashKey(key))).size).toBe(keys.length)
  })

  it('접두사는 회차의 소재불명 후보와 모든 회차의 폐기 후보를 가리킨다', () => {
    const mine = [scanKeys.missingCandidates(5), scanKeys.missingCandidates(5, { status: 'FOUND' })]
    const disposals = [scanKeys.disposalCandidates(5), scanKeys.disposalCandidates(6, 2)]
    for (const key of [...mine, scanKeys.missingCandidates(50), ...disposals]) queryClient.setQueryData<unknown>(key, {})
    const found = (queryKey: readonly unknown[]) =>
      queryClient.getQueryCache().findAll({ queryKey }).map((query) => query.queryKey)

    expect(found(scanKeys.sessionMissingCandidates(5))).toEqual(mine)
    expect(found(scanKeys.allDisposalCandidates())).toEqual(disposals)
  })

  it('옵션을 만든 뒤 조회 조건을 바꿔도 키와 요청이 어긋나지 않는다', async () => {
    const spy = vi.spyOn(getScanStore(), 'getMissingCandidates')
    const params: Omit<MissingCandidateListParams, 'page'> = { status: 'FOUND', size: 2 }
    const options = missingCandidatesInfiniteQueryOptions(6, params)
    Object.assign(params, { status: 'PENDING', size: 50 })

    await queryClient.fetchInfiniteQuery(options)

    expect(spy).toHaveBeenCalledExactlyOnceWith(6, { status: 'FOUND', size: 2, page: 0 })
  })
})

describe('후보 조회', () => {
  it.each(INVALID_IDS)('회차 ID가 %s이면 저장소를 조회하지 않는다', async (id) => {
    const spies = [vi.spyOn(getScanStore(), 'getMissingCandidates'), vi.spyOn(getScanStore(), 'getDisposalCandidates')]
    for (const observer of [missing(id), disposal(id)]) {
      unsubscribers.push(observer.subscribe(() => {}))
      expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', fetchStatus: 'idle' })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('소재불명 후보는 더보기로 이어 받고, 전체 건수는 처음부터 같다', async () => {
    getScanStore().finalizeSession(3)
    const spy = vi.spyOn(getScanStore(), 'getMissingCandidates')
    const observer = missing(3)

    const first = await settled(observer)
    expect([first.data?.totalElements, first.data?.candidates.length, first.hasNextPage]).toEqual([21, 20, true])

    // 연타해도 다음 페이지 요청은 한 번이다.
    const loadMore = () => loadMoreScanSessions((options) => observer.fetchNextPage(options))
    await Promise.all([loadMore(), loadMore()])

    const all = observer.getCurrentResult()
    expect([all.data?.totalElements, all.data?.candidates.length, all.hasNextPage]).toEqual([21, 21, false])
    expect(new Set(all.data?.candidates.map((c) => c.candidateId)).size).toBe(21)
    expect(spy.mock.calls.map(([, params]) => params?.page)).toEqual([0, 1])
  })

  it('폐기 후보는 회차 현황과 후보를 함께 주고 마지막 페이지에서 멈춘다', async () => {
    const observer = disposal(5)

    const first = await settled(observer)
    expect(first.data?.summary).toStrictEqual({ total: 111, disposalReview: 23, keep: 85, notEvaluable: 3 })
    expect([first.data?.candidates.length, first.hasNextPage]).toEqual([20, true])

    await loadMoreScanSessions((options) => observer.fetchNextPage(options))

    const all = observer.getCurrentResult()
    expect([all.data?.candidates.length, all.hasNextPage]).toEqual([23, false])
    expect(all.data?.candidates).toStrictEqual(getScanStore().getDisposalCandidates(5, { size: 100 }).page.content)
  })

  it('페이지 사이에 겹친 후보는 한 번만 담는다', async () => {
    const real = getScanStore().getDisposalCandidates(5, { size: 2 })
    vi.spyOn(getScanStore(), 'getDisposalCandidates').mockImplementation((_id, params) => ({
      ...real,
      page: { ...real.page, page: params?.page ?? 0, totalPages: 2 },
    }))
    const observer = disposal(5, 2)
    await settled(observer)
    await loadMoreScanSessions((options) => observer.fetchNextPage(options))

    expect(observer.getCurrentResult().data?.candidates).toStrictEqual(real.page.content)
  })

  it('회차마다 따로 보관하며 평가 결과가 없으면 현황이 모두 0이다', async () => {
    const [latest, none] = [await settled(disposal(5)), await settled(disposal(100))]

    expect(latest.data?.candidates).toHaveLength(20)
    expect(none.data).toStrictEqual({ summary: { total: 0, disposalReview: 0, keep: 0, notEvaluable: 0 }, candidates: [] })
    expect(none.hasNextPage).toBe(false)
    expect((await settled(missing(100))).data).toStrictEqual({ totalElements: 0, candidates: [] })
  })

  it('없는 회차는 오류를 그대로 전달한다', async () => {
    const errors = [(await settled(missing(999))).error, (await settled(disposal(999))).error]
    for (const error of errors) {
      expect(error).toMatchObject({ status: 404, code: ERROR_CODE.SCAN_SESSION_NOT_FOUND })
    }
  })
})
