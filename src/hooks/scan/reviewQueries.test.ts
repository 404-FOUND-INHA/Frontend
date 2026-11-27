import { hashKey, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import type { ReviewListParams } from '@/types/scan/review'
import { scanKeys } from './queryKeys'
import { scanReviewsQueryOptions } from './useScanReviews'

let queryClient: QueryClient

beforeEach(() => {
  resetScanStore()
  const defaults = appQueryClient.getDefaultOptions()
  queryClient = new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  })
})

afterEach(() => {
  expect(queryClient.isFetching()).toBe(0)
  queryClient.clear()
  vi.restoreAllMocks()
})

const INVALID_IDS = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]

describe('검토 조회 쿼리 키', () => {
  it('생략한 page와 size를 기본값으로 채워 같은 요청은 같은 캐시를 쓴다', async () => {
    const spy = vi.spyOn(getScanStore(), 'getReviews')
    expect(scanReviewsQueryOptions(3).queryKey).toEqual(['scan', 'reviews', 3, { page: 0, size: 20 }])

    for (const params of [undefined, {}, { page: 0 }, { size: 20 }, { shelfId: undefined, reviewed: undefined }]) {
      await queryClient.fetchQuery(scanReviewsQueryOptions(3, params))
    }

    expect(spy).toHaveBeenCalledOnce()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('회차와 조회 조건이 다르면 서로 다른 키다', () => {
    const keys = [
      scanKeys.reviews(3),
      scanKeys.reviews(2),
      scanKeys.reviews(3, { shelfId: 9 }),
      scanKeys.reviews(3, { shelfId: 10 }),
      scanKeys.reviews(3, { shelfId: Number.NaN }),
      scanKeys.reviews(3, { reviewed: true }),
      scanKeys.reviews(3, { reviewed: false }),
      scanKeys.reviews(3, { page: 1 }),
      scanKeys.reviews(3, { size: 1 }),
      scanKeys.analysis(3),
    ]
    expect(new Set(keys.map((key) => hashKey(key))).size).toBe(keys.length)
  })

  it('회차 접두사는 그 회차의 모든 검토 조회만 가리킨다', () => {
    const mine = [scanKeys.reviews(3), scanKeys.reviews(3, { reviewed: false, page: 2 })]
    const others = [scanKeys.reviews(30), scanKeys.reviews(2, { shelfId: 3 }), scanKeys.analysis(3), scanKeys.session(3)]
    for (const key of [...mine, ...others]) queryClient.setQueryData<unknown>(key, {})

    const matched = queryClient.getQueryCache().findAll({ queryKey: scanKeys.sessionReviews(3) })

    expect(matched.map((query) => query.queryKey)).toEqual(mine)
  })

  it('옵션을 만든 뒤 조회 조건 객체를 바꿔도 키와 요청이 어긋나지 않는다', async () => {
    const spy = vi.spyOn(getScanStore(), 'getReviews')
    const params: ReviewListParams = { reviewed: true, size: 2 }
    const options = scanReviewsQueryOptions(3, params)
    Object.assign(params, { reviewed: false, size: 50, shelfId: 9 })

    const data = await queryClient.fetchQuery(options)

    expect(spy).toHaveBeenCalledExactlyOnceWith(3, { shelfId: undefined, reviewed: true, page: 0, size: 2 })
    expect(data.items).toMatchObject({ size: 2, totalElements: 7 })
    expect(queryClient.getQueryData(scanKeys.reviews(3, { reviewed: true, size: 2 }))).toBe(data)
  })
})

describe('검토 조회 활성화 조건', () => {
  it.each(INVALID_IDS)('회차나 서가 ID가 %s이면 저장소를 조회하지 않는다', async (bad) => {
    const spy = vi.spyOn(getScanStore(), 'getReviews')
    const observers = [scanReviewsQueryOptions(bad), scanReviewsQueryOptions(3, { shelfId: bad })].map(
      (options) => new QueryObserver(queryClient, options),
    )
    const unsubscribers = observers.map((observer) => observer.subscribe(() => {}))
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (const observer of observers) {
      expect(observer.getCurrentResult()).toMatchObject({ status: 'pending', fetchStatus: 'idle', data: undefined })
    }
    expect(spy).not.toHaveBeenCalled()
    for (const unsubscribe of unsubscribers) unsubscribe()
  })

  it.each([undefined, { shelfId: 9 }, { reviewed: false }])('유효한 조건 %o은 조회한다', async (params) => {
    const observer = new QueryObserver(queryClient, scanReviewsQueryOptions(3, params))
    const unsubscribe = observer.subscribe(() => {})

    await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))

    expect(observer.getCurrentResult().data).toStrictEqual(getScanStore().getReviews(3, params))
    unsubscribe()
  })
})
