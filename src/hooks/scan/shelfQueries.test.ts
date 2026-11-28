import { hashKey, MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import type { ScanSessionResponse } from '@/types/scan/api'
import { scanKeys } from './queryKeys'
import { allMissingCandidatesQueryOptions } from './useAllMissingCandidates'
import { disposalCandidatesByShelfQueryOptions } from './useDisposalCandidatesByShelf'
import { finalizeScanSessionMutationOptions } from './useFinalizeScanSession'
import { completedSessionsQueryOptions, latestFinalizedSession } from './useLatestCompletedSession'
import { shelvesQueryOptions } from './useShelves'

const NOW = Date.parse('2026-11-26T03:00:00Z')
const { COMPLETED_LATEST, REVIEW_COMPLETE } = SEED_SESSION_IDS

let queryClient: QueryClient
const unsubscribers: (() => void)[] = []

beforeEach(() => {
  resetScanStore({ now: () => NOW })
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

describe('서가 배치도 쿼리 키', () => {
  it('서가는 자료실과 비활성 포함 여부에 따라 다른 키이고, 생략한 조건은 기본값이다', () => {
    expect(scanKeys.shelves({ zone: ' X ' })).toEqual(['scan', 'shelves', { zone: 'X', includeInactive: false }])
    expect(hashKey(scanKeys.shelves({ zone: '  ' }))).toBe(hashKey(scanKeys.shelves()))
    const keys = [
      scanKeys.shelves(),
      scanKeys.shelves({ includeInactive: true }),
      scanKeys.shelves({ zone: 'X' }),
      scanKeys.shelves({ zone: 'X', includeInactive: true }),
      scanKeys.shelves({ zone: 'Y', includeInactive: true }),
    ]
    expect(new Set(keys.map((key) => hashKey(key))).size).toBe(keys.length)
  })

  it('전체 조회들은 기존 조회와 다른 키이면서 확정 후 갱신하는 접두사에 속한다', () => {
    const cases = [
      [scanKeys.allMissingCandidates(5), scanKeys.sessionMissingCandidates(5), scanKeys.missingCandidates(5)],
      [scanKeys.disposalCandidatesByShelf(5), scanKeys.allDisposalCandidates(), scanKeys.disposalCandidates(5)],
      [scanKeys.completedSessions(), scanKeys.sessionLists(), scanKeys.sessionList(['COMPLETED'], 100)],
    ] as const
    for (const [key, prefix, other] of cases) {
      expect(key.slice(0, prefix.length)).toEqual([...prefix])
      expect(hashKey(key)).not.toBe(hashKey(other))
    }
  })

  it('조회하지 않아야 하는 ID(NaN)는 요청하지 않는다', () => {
    expect(allMissingCandidatesQueryOptions(Number.NaN).enabled).toBe(false)
    expect(disposalCandidatesByShelfQueryOptions(Number.NaN).enabled).toBe(false)
  })
})

describe('소재불명 후보 전체 조회', () => {
  /** 회차 5의 후보를 150건으로 만든다(두 페이지). */
  function seedManyCandidates() {
    const data = createSeedData()
    const books = data.books.filter((b) => b.expectedShelfId !== null).slice(0, 150)
    data.missingCandidates = books.map((book, index) => ({
      id: index + 1,
      sessionId: COMPLETED_LATEST,
      bookId: book.id,
      expectedShelfId: book.expectedShelfId as number,
      consecutiveMissingCount: 1,
      status: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      note: null,
      createdAt: '2026-06-20T17:30:00',
    }))
    resetScanStore({ now: () => NOW, data })
    return getScanStore()
  }

  it('100건씩 마지막 페이지까지 가져온다', async () => {
    const spy = vi.spyOn(seedManyCandidates(), 'getMissingCandidates')
    const candidates = await queryClient.fetchQuery(allMissingCandidatesQueryOptions(COMPLETED_LATEST))

    expect(candidates.map((c) => c.candidateId)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1))
    expect(spy.mock.calls.map(([, params]) => params)).toEqual([
      { page: 0, size: 100 },
      { page: 1, size: 100 },
    ])
  })

  it.each([
    ['다음 페이지가 실패하면', () => { throw new Error('실패') }],
    ['모은 수가 전체 건수와 다르면', () => ({ content: [], page: 1, size: 100, totalElements: 150, totalPages: 2 })],
  ])('%s 일부만 담은 결과를 쓰지 않는다', async (_label, secondPage) => {
    const store = seedManyCandidates()
    const read = store.getMissingCandidates
    vi.spyOn(store, 'getMissingCandidates').mockImplementation((sessionId, params) =>
      params?.page === 1 ? secondPage() : read(sessionId, params),
    )

    await expect(queryClient.fetchQuery(allMissingCandidatesQueryOptions(COMPLETED_LATEST))).rejects.toThrow()
    expect(queryClient.getQueryData(scanKeys.allMissingCandidates(COMPLETED_LATEST))).toBeUndefined()
  })
})

describe('자료실의 최근 확정 회차', () => {
  const completed = () => queryClient.fetchQuery(completedSessionsQueryOptions())
  const finalized = (id: number, finalizedAt: string) =>
    ({ id, zone: 'X', status: 'COMPLETED', finalizedAt }) as ScanSessionResponse

  it.each([
    ['12:00:00.000000', '12:00:00'],
    ['12:00:00.0', '12:00:00.000'],
    ['12:00:00.500000', '12:00:00.5'],
  ])('%s와 %s는 같은 시각이라 ID가 큰 회차다', (first, second) => {
    const a = finalized(1201, `2026-11-26T${first}`)
    const b = finalized(1202, `2026-11-26T${second}`)
    expect(latestFinalizedSession([a, b])?.id).toBe(1202)
    expect(latestFinalizedSession([b, a])?.id).toBe(1202)
    // 표기를 서로 바꿔도 같다.
    expect(
      latestFinalizedSession([{ ...a, finalizedAt: b.finalizedAt }, { ...b, finalizedAt: a.finalizedAt }])?.id,
    ).toBe(1202)
  })

  it.each([
    ['12:00:00.000001', '12:00:00'],
    ['12:00:00.123456', '12:00:00.123455'],
    ['12:00:00.1', '12:00:00.099999'],
  ])('%s는 %s보다 늦으므로 ID가 작아도 고른다', (later, earlier) => {
    const a = finalized(1, `2026-11-26T${later}`)
    const b = finalized(2, `2026-11-26T${earlier}`)
    expect(latestFinalizedSession([a, b])?.id).toBe(1)
    expect(latestFinalizedSession([b, a])?.id).toBe(1)
  })

  it('자료실마다 확정 시각이 가장 늦은 회차이고, 없으면 null이다', async () => {
    const sessions = await completed()
    expect(sessions).toHaveLength(27)
    expect(latestFinalizedSession(sessions, SEED_ZONES.HUMANITIES)?.id).toBe(COMPLETED_LATEST)
    expect(latestFinalizedSession(sessions, SEED_ZONES.SCIENCE)?.id).toBe(121)
    expect(latestFinalizedSession(sessions, SEED_ZONES.MULTIMEDIA)).toBeNull()
    expect(latestFinalizedSession(sessions)?.id).toBe(COMPLETED_LATEST)
  })

  it('생성 순서가 아니라 확정 시각으로 고르고, 같으면 ID가 큰 회차다', () => {
    const session = (id: number, createdAt: string, finalizedAt: string) =>
      ({ id, zone: 'X', status: 'COMPLETED', createdAt, finalizedAt }) as ScanSessionResponse
    const older = session(1, '2026-01-01T09:00:00', '2026-03-01T09:00:00')
    const newer = session(2, '2026-02-01T09:00:00', '2026-02-02T09:00:00')
    expect(latestFinalizedSession([newer, older])?.id).toBe(1)
    expect(latestFinalizedSession([older, { ...older, id: 3 }])?.id).toBe(3)
  })
})

describe('회차 확정 후 갱신', () => {
  it('서가의 도서 수, 최근 확정 회차, 후보 조회를 다시 불러온다', async () => {
    const store = getScanStore()
    const shelves = new QueryObserver(queryClient, shelvesQueryOptions({ zone: SEED_ZONES.SCIENCE, includeInactive: true }))
    const sessions = new QueryObserver(queryClient, completedSessionsQueryOptions())
    const missing = new QueryObserver(queryClient, allMissingCandidatesQueryOptions(REVIEW_COMPLETE))
    const byShelf = new QueryObserver(queryClient, disposalCandidatesByShelfQueryOptions(COMPLETED_LATEST))
    for (const observer of [shelves, sessions, missing, byShelf]) unsubscribers.push(observer.subscribe(() => {}))
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))
    expect(missing.getCurrentResult().data).toEqual([])
    const countsBefore = shelves.getCurrentResult().data!.map((s) => s.bookCount)
    const byShelfSpy = vi.spyOn(store, 'getDisposalCandidatesByShelf')

    await new MutationObserver(queryClient, finalizeScanSessionMutationOptions(queryClient, REVIEW_COMPLETE)).mutate()

    expect(missing.getCurrentResult().data).toHaveLength(21)
    expect(latestFinalizedSession(sessions.getCurrentResult().data!, SEED_ZONES.SCIENCE)?.id).toBe(REVIEW_COMPLETE)
    const countsAfter = shelves.getCurrentResult().data!.map((s) => s.bookCount)
    expect(countsAfter).not.toEqual(countsBefore)
    expect(countsAfter).toEqual(store.getShelves({ zone: SEED_ZONES.SCIENCE, includeInactive: true }).map((s) => s.bookCount))
    expect(byShelfSpy).toHaveBeenCalledWith(COMPLETED_LATEST)
  })
})
