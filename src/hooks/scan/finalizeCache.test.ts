import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
  type InfiniteQueryObserverOptions,
  type QueryKey,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { getObservationDetail, getScanAnalysis, getShelfObservations } from '@/api/scanAnalysis'
import { getDisposalCandidates, getMissingCandidates } from '@/api/scanResults'
import { getScanReviews } from '@/api/scanReviews'
import { getScanRooms, getScanSession, getScanSessions } from '@/api/scanSessions'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import { scanKeys } from './queryKeys'
import { disposalCandidatesInfiniteQueryOptions } from './useDisposalCandidates'
import { finalizeScanSessionMutationOptions } from './useFinalizeScanSession'
import { missingCandidatesInfiniteQueryOptions } from './useMissingCandidates'
import { observationDetailQueryOptions } from './useObservationDetail'
import { scanAnalysisQueryOptions } from './useScanAnalysis'
import { scanReviewsQueryOptions } from './useScanReviews'
import { scanRoomsQueryOptions } from './useScanRooms'
import { scanSessionQueryOptions } from './useScanSession'
import { scanSessionsInfiniteQueryOptions } from './useScanSessions'
import { shelfObservationsQueryOptions } from './useShelfObservations'

// 확정 mutation의 실제 옵션과 갱신 함수를 실제 QueryClient와 Observer 위에서 실행해 검증한다.

const NOW = Date.parse('2026-11-26T03:00:00Z')
const SID = SEED_SESSION_IDS.REVIEW_COMPLETE

/**
 * 확정 대상 회차가 확인하는 도서를 소재불명으로 두고, 같은 도서를 관측한 "다른 회차"의 관측을 고른다.
 * 확정하면 그 도서가 정상으로 돌아와 다른 회차의 관측 응답(matchedBook)도 달라진다.
 */
function seedWithCrossSessionBook() {
  const data = createSeedData()
  const found = new Set(
    data.observations.filter((o) => o.sessionId === SID && o.analysisStatus === 'NORMAL').map((o) => o.bookId),
  )
  const other = data.observations.find((o) => o.sessionId !== SID && o.bookId !== null && found.has(o.bookId))
  if (!other) throw new Error('다른 회차에서도 관측한 도서가 필요합니다')
  data.books.filter((b) => b.id === other.bookId).forEach((b) => (b.lifecycleStatus = 'MISSING'))
  return { data, other }
}

const { other } = seedWithCrossSessionBook()

let queryClient: QueryClient
const unsubscribers: (() => void)[] = []

beforeEach(() => {
  resetScanStore({ now: () => NOW, data: seedWithCrossSessionBook().data })
  const defaults = appQueryClient.getDefaultOptions()
  queryClient = new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  })
})

afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  expect(queryClient.isFetching()).toBe(0)
  expect(queryClient.isMutating()).toBe(0)
  queryClient.clear()
  vi.restoreAllMocks()
})

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function finalize(sessionId: number = SID) {
  const observer = new MutationObserver(queryClient, finalizeScanSessionMutationOptions(queryClient, sessionId))
  return { observer, done: observer.mutate() }
}

interface Watcher {
  subscribe(listener: () => void): () => void
  refetch(): Promise<unknown>
  getCurrentResult(): { status: string; fetchStatus: string }
}

function subscribe(watcher: Watcher) {
  const unsubscribe = watcher.subscribe(() => {})
  unsubscribers.push(unsubscribe)
  return unsubscribe
}

async function loaded(watcher: Watcher) {
  await vi.waitFor(() => expect(watcher.getCurrentResult()).toMatchObject({ status: 'success', fetchStatus: 'idle' }))
}

const STALE = 'staleResponse'

/** hold() 다음의 요청 하나는 그 시점의 응답을 읽어 두고, release()를 부를 때까지 돌려주지 않는다. */
function controllable<T extends object>(read: () => Promise<T>) {
  let holdNext = false
  let snapshot: Promise<T> | undefined
  let release = () => {}
  return {
    queryFn: async (): Promise<T> => {
      if (!holdNext) return read()
      holdNext = false
      const gate = new Promise<void>((resolve) => (release = resolve))
      snapshot = read()
      const response = await snapshot
      await gate
      return { ...response, [STALE]: true }
    },
    hold: () => {
      holdNext = true
    },
    /** 붙잡힌 요청이 저장소를 읽을 때까지 기다린다. */
    taken: async () => {
      await vi.waitFor(() => expect(snapshot).toBeDefined())
      await snapshot
    },
    release: () => release(),
  }
}

interface RaceTarget {
  name: string
  key: QueryKey
  start(): {
    watcher: Watcher
    held: ReturnType<typeof controllable>
    /** 캐시 데이터에서 저장소 응답에 해당하는 부분 */
    unwrap(data: unknown): unknown
    read(): Promise<unknown>
  }
}

function raceTarget<T extends object>(
  name: string,
  options: { queryKey: QueryKey },
  read: () => Promise<T>,
): RaceTarget {
  return {
    name,
    key: options.queryKey,
    start() {
      const held = controllable(read)
      const watcher = new QueryObserver(queryClient, { queryKey: options.queryKey, queryFn: held.queryFn })
      return { watcher, held, unwrap: (data) => data, read }
    },
  }
}

/** 무한 조회의 첫 페이지 요청을 붙잡는다. 캐시에는 선택(select) 전의 페이지가 담긴다. */
function infiniteRaceTarget<T extends object, TData, TKey extends QueryKey>(
  name: string,
  options: InfiniteQueryObserverOptions<T, Error, TData, TKey, number>,
  read: () => Promise<T>,
): RaceTarget {
  return {
    name,
    key: options.queryKey,
    start() {
      const held = controllable(read)
      const watcher = new InfiniteQueryObserver(queryClient, { ...options, queryFn: held.queryFn })
      return { watcher, held, unwrap: (data) => (data as { pages: unknown[] }).pages[0], read }
    },
  }
}

const listOptions = scanSessionsInfiniteQueryOptions(['REVIEW'])
const readList = () => getScanSessions({ status: ['REVIEW'], page: 0, size: 20 })

const RACE_TARGETS: RaceTarget[] = [
  {
    name: '회차 목록',
    key: listOptions.queryKey,
    start() {
      const held = controllable(readList)
      const watcher = new InfiniteQueryObserver(queryClient, { ...listOptions, queryFn: held.queryFn })
      return { watcher, held, unwrap: (data) => (data as { pages: unknown[] }).pages[0], read: readList }
    },
  },
  raceTarget('회차 상세', scanSessionQueryOptions(SID), () => getScanSession(SID)),
  raceTarget('자료실', scanRoomsQueryOptions(), getScanRooms),
  raceTarget('분석 요약', scanAnalysisQueryOptions(SID), () => getScanAnalysis(SID)),
  raceTarget('검토 목록', scanReviewsQueryOptions(SID), () => getScanReviews(SID)),
  raceTarget('다른 회차의 서가 관측', shelfObservationsQueryOptions(other.sessionId, other.shelfId), () =>
    getShelfObservations(other.sessionId, other.shelfId),
  ),
  raceTarget('다른 회차의 관측 상세', observationDetailQueryOptions(other.sessionId, other.id), () =>
    getObservationDetail(other.sessionId, other.id),
  ),
  infiniteRaceTarget('소재불명 후보', missingCandidatesInfiniteQueryOptions(SID), () => getMissingCandidates(SID, { size: 20 })),
  infiniteRaceTarget('다른 회차의 폐기 후보', disposalCandidatesInfiniteQueryOptions(SEED_SESSION_IDS.COMPLETED_LATEST), () =>
    getDisposalCandidates(SEED_SESSION_IDS.COMPLETED_LATEST, { size: 20 }),
  ),
]

describe.each(RACE_TARGETS)('확정 전에 시작한 요청의 늦은 응답: $name', ({ key, start }) => {
  it.each([
    ['활성 최초 조회', true, false],
    ['활성 재조회', true, true],
    ['비활성 최초 조회', false, false],
    ['비활성 재조회', false, true],
  ])('%s의 응답은 캐시에 남지 않는다', async (_label, active, hasData) => {
    const { watcher, held, unwrap, read } = start()
    if (!hasData) held.hold()
    const unsubscribe = subscribe(watcher)
    if (hasData) {
      await loaded(watcher)
      held.hold()
      void watcher.refetch()
    }
    await held.taken() // 확정 전의 응답
    if (!active) unsubscribe()

    const { done } = finalize()
    // 갱신이 붙잡힌 요청을 기다리지 않아야 한다. 기다리는 구현이면 여기서 늦은 응답이 도착한다.
    await Promise.race([done, tick(50)])
    held.release()
    await done
    await tick()

    const state = queryClient.getQueryState(key)
    expect(state?.fetchStatus).toBe('idle')
    expect(JSON.stringify(state?.data ?? null)).not.toContain(STALE)
    if (active) {
      expect(state).toMatchObject({ status: 'success', isInvalidated: false })
      expect(unwrap(state?.data)).toStrictEqual(await read())
    } else {
      expect(state?.isInvalidated).toBe(true)
      if (!hasData) expect(state?.data).toBeUndefined()
    }
  })
})

describe('확정 성공 후 캐시 갱신', () => {
  it('대상은 다시 불러오거나 무효화하고, 다른 회차의 상세·분석·검토는 그대로 둔다', async () => {
    const detail = new QueryObserver(queryClient, scanSessionQueryOptions(SID))
    const reviewList = new InfiniteQueryObserver(queryClient, listOptions)
    const rooms = new QueryObserver(queryClient, scanRoomsQueryOptions())
    const analysis = new QueryObserver(queryClient, scanAnalysisQueryOptions(SID))
    const shelf = new QueryObserver(queryClient, shelfObservationsQueryOptions(other.sessionId, other.shelfId))
    const observation = new QueryObserver(queryClient, observationDetailQueryOptions(other.sessionId, other.id))
    for (const watcher of [detail, reviewList, rooms, analysis, shelf, observation]) {
      subscribe(watcher)
      await loaded(watcher)
    }
    expect(observation.getCurrentResult().data?.matchedBook?.lifecycleStatus).toBe('MISSING')

    const inactive = [
      scanSessionsInfiniteQueryOptions(),
      scanSessionsInfiniteQueryOptions(['COMPLETED'], 5),
    ]
    for (const options of inactive) await queryClient.fetchInfiniteQuery(options)
    await queryClient.fetchQuery(scanReviewsQueryOptions(SID))
    await queryClient.fetchQuery(scanReviewsQueryOptions(SID, { reviewed: false, size: 5 }))

    const OTHER = SEED_SESSION_IDS.REVIEW_PARTIAL
    await queryClient.fetchQuery(scanSessionQueryOptions(OTHER))
    await queryClient.fetchQuery(scanAnalysisQueryOptions(OTHER))
    await queryClient.fetchQuery(scanReviewsQueryOptions(OTHER))
    const untouched = [scanKeys.session(OTHER), scanKeys.analysis(OTHER), scanKeys.reviews(OTHER)]
    const before = untouched.map((key) => queryClient.getQueryState(key))

    const response = await finalize().done

    expect(response).toMatchObject({ sessionId: SID, status: 'COMPLETED' })
    expect(detail.getCurrentResult().data).toStrictEqual(getScanStore().getSession(SID))
    expect(reviewList.getCurrentResult().data?.pages[0].content.map((s) => s.id)).toEqual([4, 2])
    expect(rooms.getCurrentResult().data?.find((r) => r.zone === SEED_ZONES.SCIENCE)?.hasOpenSession).toBe(false)
    expect(analysis.getCurrentResult().data?.session.status).toBe('COMPLETED')
    expect(observation.getCurrentResult().data?.matchedBook?.lifecycleStatus).toBe('NORMAL')
    expect(shelf.getCurrentResult().data?.observations.find((o) => o.bookId === other.bookId)?.matchedBook?.lifecycleStatus).toBe(
      'NORMAL',
    )
    for (const key of [
      ...inactive.map((options) => options.queryKey),
      scanKeys.reviews(SID),
      scanKeys.reviews(SID, { reviewed: false, size: 5 }),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }
    // 상태 객체가 같으면 무효화, 직접 쓰기, 재조회가 모두 없었던 것이다.
    untouched.forEach((key, index) => expect(queryClient.getQueryState(key)).toBe(before[index]))
  })

  it('해당 회차의 소재불명 후보와 모든 회차의 폐기 후보를 갱신하고, 다른 회차의 소재불명 후보는 그대로 둔다', async () => {
    const candidates = new InfiniteQueryObserver(queryClient, missingCandidatesInfiniteQueryOptions(SID))
    subscribe(candidates)
    await loaded(candidates)
    expect(candidates.getCurrentResult().data?.totalElements).toBe(0)

    const { COMPLETED_LATEST, COMPLETED_PREVIOUS } = SEED_SESSION_IDS
    const disposals = [SID, COMPLETED_LATEST, COMPLETED_PREVIOUS].map((id) => disposalCandidatesInfiniteQueryOptions(id))
    for (const options of disposals) await queryClient.fetchInfiniteQuery(options)
    const otherMissing = missingCandidatesInfiniteQueryOptions(COMPLETED_LATEST)
    await queryClient.fetchInfiniteQuery(otherMissing)
    const before = queryClient.getQueryState(otherMissing.queryKey)

    const response = await finalize().done

    expect(candidates.getCurrentResult().data?.totalElements).toBe(response.summary.missingCandidates)
    for (const options of disposals) expect(queryClient.getQueryState(options.queryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(otherMissing.queryKey)).toBe(before)
  })

  it('캐시에 없는 회차 상세는 만들지 않는다', async () => {
    await finalize().done
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  it.each([
    ['화면에 떠 있는', true],
    ['화면에 없는', false],
  ])('%s 회차 상세는 재조회가 실패하거나 없어도 확정 상태다', async (_label, active) => {
    if (active) {
      const detail = new QueryObserver(queryClient, scanSessionQueryOptions(SID))
      subscribe(detail)
      await loaded(detail)
    } else {
      await queryClient.fetchQuery(scanSessionQueryOptions(SID))
    }
    const getSession = vi.spyOn(getScanStore(), 'getSession').mockImplementation(() => {
      throw new Error('재조회 실패')
    })

    const { observer, done } = finalize()
    const response = await done

    expect(observer.getCurrentResult().status).toBe('success')
    expect(getSession).toHaveBeenCalledTimes(active ? 1 : 0)
    const state = queryClient.getQueryState(scanKeys.session(SID))
    expect(state).toMatchObject({ status: active ? 'error' : 'success', isInvalidated: true })
    getSession.mockRestore()
    expect(state?.data).toStrictEqual(getScanStore().getSession(SID))
    expect(state?.data).toMatchObject({ status: 'COMPLETED', processingStage: 'ANALYSIS_DONE', finalizedAt: response.finalizedAt })
  })

  it('갱신이 끝날 때까지 회차별 mutation이 pending이다', async () => {
    const held = controllable(() => getScanReviews(SID))
    const reviews = new QueryObserver(queryClient, { ...scanReviewsQueryOptions(SID), queryFn: held.queryFn })
    subscribe(reviews)
    await loaded(reviews)
    held.hold() // 확정 후의 재조회를 붙잡는다

    const { observer, done } = finalize()
    await held.taken()
    await tick()

    expect(getScanStore().getSession(SID).status).toBe('COMPLETED')
    expect(observer.getCurrentResult().status).toBe('pending')
    expect(queryClient.isMutating({ mutationKey: scanKeys.finalize(SID) })).toBe(1)
    expect(queryClient.isMutating({ mutationKey: scanKeys.finalize(SEED_SESSION_IDS.REVIEW_PARTIAL) })).toBe(0)

    held.release()
    await done
    expect(observer.getCurrentResult().status).toBe('success')
  })

  it('캐시 갱신이 실패해도 성공한 확정은 성공이다', async () => {
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('갱신 실패'))

    const { observer, done } = finalize()

    await expect(done).resolves.toMatchObject({ status: 'COMPLETED' })
    expect(observer.getCurrentResult()).toMatchObject({ status: 'success', error: null })
  })
})

describe('확정 실패 후 캐시 갱신', () => {
  /** 대상 회차와 관련 없는 회차(100)의 캐시를 구독 없이 채운다. 값의 내용은 쓰지 않는다. */
  function prime(sessionId: number) {
    const keys: Record<string, QueryKey> = {
      목록: scanKeys.sessionList(undefined, 20),
      상세: scanKeys.session(sessionId),
      자료실: scanKeys.rooms(),
      분석: scanKeys.analysis(sessionId),
      검토: scanKeys.reviews(sessionId),
      서가관측: scanKeys.shelfObservations(101, 1),
      관측상세: scanKeys.observation(101, 1),
      소재불명후보: scanKeys.missingCandidates(sessionId),
      '다른 회차의 폐기후보': scanKeys.disposalCandidates(100),
      '다른 소재불명후보': scanKeys.missingCandidates(100),
      '다른 상세': scanKeys.session(100),
      '다른 분석': scanKeys.analysis(100),
      '다른 검토': scanKeys.reviews(100),
    }
    return Object.entries(keys).map(([name, key]) => {
      const data = { name }
      queryClient.setQueryData<unknown>(key, data)
      return { name, key, data }
    })
  }

  const throwing = (error: Error) => () => {
    vi.spyOn(getScanStore(), 'finalizeSession').mockImplementation(() => {
      throw error
    })
  }
  const apiError = (status: number, code: string) => new ApiError(status, { code, message: '실패', errors: [] })

  it.each<[string, number, (() => void) | null, string[]]>([
    [
      'SCAN_009',
      SEED_SESSION_IDS.COMPLETED_LATEST,
      null,
      ['목록', '상세', '자료실', '분석', '검토', '서가관측', '관측상세', '소재불명후보', '다른 회차의 폐기후보'],
    ],
    ['SCAN_010', SEED_SESSION_IDS.REVIEW_PARTIAL, null, ['검토']],
    ['SCAN_001', 999, null, ['상세']],
    ['COMMON_999', SID, throwing(apiError(500, ERROR_CODE.INTERNAL_SERVER_ERROR)), []],
    ['COMMON_001', SID, throwing(apiError(400, ERROR_CODE.INVALID_INPUT)), []],
    ['ApiError가 아닌 오류', SID, throwing(new Error('연결 실패')), []],
  ])('%s: 회차 %s에서 정해진 캐시만 무효화하고 값은 직접 바꾸지 않는다', async (label, sessionId, arrange, expected) => {
    arrange?.()
    const entries = prime(sessionId)
    const storeBefore = getScanStore().snapshot()

    const { observer, done } = finalize(sessionId)
    const error = await done.catch((e: unknown) => e)

    if (label.includes('_')) expect(error).toMatchObject({ code: label })
    expect(observer.getCurrentResult()).toMatchObject({ status: 'error', error })
    expect(entries.filter(({ key }) => queryClient.getQueryState(key)?.isInvalidated).map(({ name }) => name)).toEqual(expected)
    for (const { key, data } of entries) expect(queryClient.getQueryData(key)).toBe(data)
    expect(getScanStore().snapshot()).toStrictEqual(storeBefore)
  })

  it('다른 곳에서 먼저 확정한 회차(SCAN_009)는 화면의 상세를 다시 불러온다', async () => {
    const detail = new QueryObserver(queryClient, scanSessionQueryOptions(SID))
    subscribe(detail)
    await loaded(detail)
    getScanStore().finalizeSession(SID)

    await expect(finalize().done).rejects.toMatchObject({ code: ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE })

    expect(detail.getCurrentResult().data).toStrictEqual(getScanStore().getSession(SID))
  })

  it('SCAN_009 갱신도 확정 전에 시작한 최초 조회의 늦은 응답을 남기지 않는다', async () => {
    const held = controllable(() => getScanSession(SID))
    held.hold()
    const detail = new QueryObserver(queryClient, { ...scanSessionQueryOptions(SID), queryFn: held.queryFn })
    subscribe(detail)
    await held.taken()
    getScanStore().finalizeSession(SID)

    const { done } = finalize()
    const rejected = expect(done).rejects.toMatchObject({ code: ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE })
    await Promise.race([done.catch(() => {}), tick(50)])
    held.release()
    await rejected
    await tick()

    expect(detail.getCurrentResult().data).toStrictEqual(getScanStore().getSession(SID))
  })

  it('캐시 갱신이 실패해도 원래의 확정 오류를 전달한다', async () => {
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('갱신 실패'))

    await expect(finalize(SEED_SESSION_IDS.REVIEW_PARTIAL).done).rejects.toMatchObject({
      code: ERROR_CODE.SCAN_REVIEW_INCOMPLETE,
    })
    await tick()
  })
})
