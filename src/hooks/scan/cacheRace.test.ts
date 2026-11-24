import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
  type InfiniteData,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { SEED_ZONES } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import type { PageResponse, ScanRoomResponse, ScanSessionResponse } from '@/types/scan/api'
import { scanKeys } from './queryKeys'
import { createScanSessionMutationOptions } from './useCreateScanSession'
import { scanRoomsQueryOptions } from './useScanRooms'
import { loadMoreScanSessions, scanSessionsInfiniteQueryOptions } from './useScanSessions'

// 회차 생성과 더보기 요청이 겹치는 경합을 실제 300ms Mock 지연과 가짜 타이머로 순서를 고정해 재현한다.
// 테스트는 제품 코드(createScanSessionMutationOptions, invalidateAfterCreate, loadMoreScanSessions)를 그대로 호출하며,
// 안전한 더보기나 캐시 갱신 로직을 따로 다시 만들지 않는다.
//
// Mock은 응답 시점에 저장소를 읽으므로, 생성 이전에 시작한 요청의 "늦은 응답"은 생성 이후의 데이터(한 칸씩 밀린 목록)를 담는다.
// 이 늦은 응답이 생성 이전 첫 페이지와 섞이는 것이 문제의 핵심이다.

const NOW = Date.parse('2026-11-24T03:00:00Z')
const PAGE_SIZE = 5
const KEY = scanKeys.sessionList(undefined, PAGE_SIZE)

type ListData = InfiniteData<PageResponse<ScanSessionResponse>, number>

let queryClient: QueryClient
const cleanups: (() => void)[] = []

beforeEach(() => {
  vi.stubEnv('MODE', 'development') // 테스트용 무지연 모드를 끄고 실제 300ms 지연을 사용
  vi.useFakeTimers()
  resetScanStore({ now: () => NOW })
  const defaults = appQueryClient.getDefaultOptions()
  queryClient = new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  })
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  expect(queryClient.isFetching()).toBe(0) // 테스트가 모든 요청을 끝까지 진행시켰는지 확인
  expect(queryClient.isMutating()).toBe(0)
  queryClient.clear()
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

function subscribe() {
  const observer = new InfiniteQueryObserver(queryClient, scanSessionsInfiniteQueryOptions(undefined, PAGE_SIZE))
  const unsubscribe = observer.subscribe(() => {})
  cleanups.push(unsubscribe)
  expect(observer.hasListeners()).toBe(true)
  return {
    observer,
    unsubscribe: () => {
      unsubscribe()
      expect(observer.hasListeners()).toBe(false)
    },
    loadMore: () => loadMoreScanSessions((options) => observer.fetchNextPage(options)),
  }
}

function subscribeRooms() {
  const observer = new QueryObserver(queryClient, scanRoomsQueryOptions())
  const unsubscribe = observer.subscribe(() => {})
  cleanups.push(unsubscribe)
  return observer
}

function startCreate(zone: string = SEED_ZONES.REFERENCE) {
  const mutation = new MutationObserver(queryClient, createScanSessionMutationOptions(queryClient))
  return mutation.mutate({ sessionName: '경합 테스트 회차', zone })
}

const cachedList = () => queryClient.getQueryData<ListData>(KEY)
const idsOf = (data: ListData | undefined) => data?.pages.flatMap((page) => page.content.map((s) => s.id))
/** 저장소의 최신순 앞쪽 count건 (페이지네이션으로 이어 붙인 결과와 같은 범위·순서여야 한다) */
const storeIds = (count: number) => getScanStore().getSessions({ size: count }).content.map((s) => s.id)

function expectConsistentPages(data: ListData | undefined, pageCount: number, totalElements = 32) {
  const ids = idsOf(data)
  expect(data?.pages).toHaveLength(pageCount)
  expect(new Set(ids).size).toBe(ids?.length) // 기존 회차 중복 없음
  expect(ids).toEqual(storeIds(PAGE_SIZE * pageCount)) // 신규 회차 누락 없이 저장소의 같은 범위·순서
  for (const page of data?.pages ?? []) expect(page.totalElements).toBe(totalElements) // 모든 페이지가 같은 시점의 총 건수
}

describe('회차 생성과 더보기가 겹치는 경합', () => {
  it('A. 비활성 목록의 늦은 더보기 응답이 무효화 표시를 지우거나 캐시를 섞지 못한다', async () => {
    const view = subscribe()
    await advance(300)
    expect(cachedList()?.pages).toHaveLength(1)
    expect(idsOf(cachedList())).toEqual(storeIds(5)) // 생성 이전의 첫 페이지

    const creating = startCreate() // 응답과 저장은 300ms 뒤
    await advance(100)
    const more = view.loadMore() // 응답 예정: 생성보다 100ms 늦음
    expect(view.observer.getCurrentResult().isFetchingNextPage).toBe(true)
    view.unsubscribe() // 목록이 비활성이 된다

    await advance(200) // 생성 성공 → 진행 중인 더보기 취소 → 무효화
    const created = await creating
    const stateAfterCreate = queryClient.getQueryState(KEY)
    expect(stateAfterCreate?.isInvalidated).toBe(true)
    expect(stateAfterCreate?.fetchStatus).toBe('idle')
    expect(cachedList()?.pages).toHaveLength(1)
    const dataAfterCreate = cachedList()

    await advance(200) // 취소된 더보기의 응답 예정 시점이 지난다
    await more
    expect(queryClient.getQueryState(KEY)?.isInvalidated).toBe(true) // 무효화 상태 유지
    expect(cachedList()).toBe(dataAfterCreate) // 늦은 응답이 캐시에 쓰이지 않았다

    // 목록을 다시 열면 무효화된 데이터를 최신으로 재조회한다
    const reopened = subscribe()
    await advance(300)
    expect(queryClient.getQueryState(KEY)?.isInvalidated).toBe(false)
    expect(idsOf(cachedList())?.[0]).toBe(created.id)
    expectConsistentPages(cachedList(), 1)

    const loading = reopened.loadMore()
    await advance(300)
    await loading
    expectConsistentPages(cachedList(), 2)
  })

  it('B. 생성 후 재조회가 진행되는 동안 더보기를 호출해도 재조회가 취소·대체되지 않는다', async () => {
    const view = subscribe()
    await advance(300)

    const creating = startCreate()
    let settled = false
    void creating.then(
      () => (settled = true),
      () => (settled = true),
    )
    await advance(300) // 생성 성공 → 무효화 → 활성 목록 재조회 시작
    expect(settled).toBe(false) // 갱신이 끝날 때까지 mutation은 pending
    expect(view.observer.getCurrentResult().isRefetching).toBe(true)

    await advance(100)
    const more = view.loadMore() // 재조회 도중 더보기
    const duringRefetch = view.observer.getCurrentResult()
    expect(duringRefetch.isFetchingNextPage).toBe(false) // 재조회를 더보기로 대체하지 않았다
    expect(duringRefetch.isRefetching).toBe(true)
    expect(settled).toBe(false)

    await advance(200) // 재조회 완료
    await more
    await creating
    expect(settled).toBe(true)
    expectConsistentPages(cachedList(), 1) // 생성 이후의 첫 페이지 한 개만 있고 다음 페이지가 섞이지 않았다
    expect(view.observer.getCurrentResult().hasNextPage).toBe(true)
    expect(idsOf(cachedList())?.[0]).toBeGreaterThan(123) // 신규 회차가 맨 앞

    // 재조회가 끝난 뒤 다시 호출하면 최신 데이터 위에서 다음 페이지를 불러온다
    const again = view.loadMore()
    await advance(300)
    await again
    expectConsistentPages(cachedList(), 2)
  })

  it('C1. 더보기 진행 중 생성이 성공해도 활성 목록은 최신 첫 페이지로 정상 갱신된다', async () => {
    const view = subscribe()
    await advance(300)

    const creating = startCreate()
    await advance(100)
    const more = view.loadMore()
    await advance(200) // 생성 성공: 진행 중인 더보기를 취소하고 활성 목록을 재조회
    await advance(300) // 재조회 완료
    await creating
    await more

    expect(queryClient.getQueryState(KEY)?.isInvalidated).toBe(false)
    expectConsistentPages(cachedList(), 1)
    expect(view.observer.getCurrentResult().hasNextPage).toBe(true)

    const again = view.loadMore()
    await advance(300)
    await again
    expectConsistentPages(cachedList(), 2)
  })

  it('C2. 일반적인 더보기는 페이지를 차례로 이어 붙이고, 연타해도 요청이 중복되지 않는다', async () => {
    const view = subscribe()
    await advance(300)

    const first = view.loadMore()
    const second = view.loadMore() // 같은 순간의 두 번째 호출은 진행 중인 요청을 기다린다
    await advance(300)
    await Promise.all([first, second])
    expect(cachedList()?.pages.map((page) => page.page)).toEqual([0, 1])

    const third = view.loadMore()
    await advance(300)
    await third
    expect(cachedList()?.pages.map((page) => page.page)).toEqual([0, 1, 2])
    const ids = idsOf(cachedList())
    expect(new Set(ids).size).toBe(ids?.length)
    expect(ids).toEqual(getScanStore().getSessions({ size: 15 }).content.map((s) => s.id))
  })

  it('E. 서로 다른 자료실의 생성이 겹쳐도 첫 mutation은 자신의 결과가 활성 캐시에 반영된 뒤에 성공한다', async () => {
    // 활성 구독: 목록 3페이지(페이지 크기 5)와 자료실
    const view = subscribe()
    const rooms = subscribeRooms()
    await advance(300)
    for (let page = 1; page < 3; page++) {
      const loading = view.loadMore()
      await advance(300)
      await loading
    }
    expect(cachedList()?.pages).toHaveLength(3)

    const roomOpen = (zone: string) =>
      queryClient.getQueryData<ScanRoomResponse[]>(scanKeys.rooms())?.find((room) => room.zone === zone)?.hasOpenSession

    // 각 mutation이 성공하는 순간의 실제 캐시 값을 기록한다
    interface Outcome {
      settled: boolean
      listIds?: number[]
      listTotals?: number[]
      roomOpen?: boolean
    }
    const track = (promise: Promise<ScanSessionResponse>, zone: string): Outcome => {
      const outcome: Outcome = { settled: false }
      void promise.then(() => {
        outcome.settled = true
        outcome.listIds = idsOf(cachedList())
        outcome.listTotals = cachedList()?.pages.map((page) => page.totalElements)
        outcome.roomOpen = roomOpen(zone)
      })
      return outcome
    }

    const creatingA = startCreate(SEED_ZONES.REFERENCE) // 0ms
    const a = track(creatingA, SEED_ZONES.REFERENCE)
    await advance(100)
    const creatingB = startCreate(SEED_ZONES.MULTIMEDIA) // 100ms
    const b = track(creatingB, SEED_ZONES.MULTIMEDIA)

    await advance(200) // 300ms: 첫 회차 저장 → 목록(3페이지)·자료실 재조회 시작
    expect(a.settled).toBe(false) // 첫 mutation은 갱신이 끝날 때까지 pending
    expect(view.observer.getCurrentResult().isRefetching).toBe(true)
    expect(cachedList()?.pages[0].totalElements).toBe(31) // 아직 생성 전 데이터

    await advance(100) // 400ms: 둘째 회차 저장 → 재조회가 새 재조회로 교체된다
    expect(getScanStore().getSessions().totalElements).toBe(33) // 두 회차 모두 저장됨
    expect(a.settled).toBe(false) // 교체되어도 첫 mutation이 조기에 성공하지 않는다
    expect(b.settled).toBe(false)
    expect(cachedList()?.pages[0].totalElements).toBe(31)

    await advance(300) // 700ms: 자료실 재조회 완료, 목록은 아직 진행 중
    expect(roomOpen(SEED_ZONES.REFERENCE)).toBe(true)
    expect(roomOpen(SEED_ZONES.MULTIMEDIA)).toBe(true)
    expect(a.settled).toBe(false) // 목록 갱신 전이므로 아직 성공하면 안 된다
    expect(b.settled).toBe(false)

    await advance(300) // 1000ms: 목록 재조회 진행 중
    expect(a.settled).toBe(false)
    expect(b.settled).toBe(false)

    await advance(300) // 1300ms: 목록 재조회 완료
    const [createdA, createdB] = await Promise.all([creatingA, creatingB])
    expect(a.settled && b.settled).toBe(true)

    // 각 mutation이 성공한 시점에 자신의 회차가 활성 목록과 자료실에 이미 반영되어 있었다
    for (const [outcome, created] of [
      [a, createdA],
      [b, createdB],
    ] as const) {
      expect(outcome.listIds).toContain(created.id)
      expect(outcome.listTotals).toEqual([33, 33, 33])
      expect(outcome.roomOpen).toBe(true)
    }

    // 최종 목록: 저장소의 같은 범위·순서와 일치하고 중복·누락이 없다
    expect(idsOf(cachedList())?.slice(0, 2)).toEqual([createdB.id, createdA.id])
    expectConsistentPages(cachedList(), 3, 33)
    expect(rooms.getCurrentResult().isFetching).toBe(false)
    expect(view.observer.getCurrentResult().isFetching).toBe(false)
  })

  it('F. 자료실만 활성 구독이어도 겹친 생성의 첫 mutation은 자료실이 갱신된 뒤에 성공한다', async () => {
    // 목록 캐시 없이 자료실만 활성 구독: 목록 재조회가 길어 가려지던 자료실 취소 문제를 따로 확인한다
    const rooms = subscribeRooms()
    await advance(300)
    const roomOpen = (zone: string) =>
      queryClient.getQueryData<ScanRoomResponse[]>(scanKeys.rooms())?.find((room) => room.zone === zone)?.hasOpenSession
    expect(roomOpen(SEED_ZONES.REFERENCE)).toBe(false)
    expect(roomOpen(SEED_ZONES.MULTIMEDIA)).toBe(false)

    const settled = { a: false, b: false }
    const atSuccess: Record<string, boolean | undefined> = {}
    const creatingA = startCreate(SEED_ZONES.REFERENCE) // 0ms
    void creatingA.then(() => {
      settled.a = true
      atSuccess.a = roomOpen(SEED_ZONES.REFERENCE)
    })
    await advance(100)
    const creatingB = startCreate(SEED_ZONES.MULTIMEDIA) // 100ms
    void creatingB.then(() => {
      settled.b = true
      atSuccess.b = roomOpen(SEED_ZONES.MULTIMEDIA)
    })

    await advance(200) // 300ms: 첫 회차 저장 → 자료실 재조회 시작
    expect(rooms.getCurrentResult().isRefetching).toBe(true)
    expect(settled.a).toBe(false)

    await advance(100) // 400ms: 둘째 회차 저장 → 자료실 재조회 교체
    expect(settled.a).toBe(false) // 교체되어도 첫 mutation은 조기에 성공하지 않는다
    expect(settled.b).toBe(false)
    expect(roomOpen(SEED_ZONES.REFERENCE)).toBe(false) // 아직 갱신 전

    await advance(250) // 650ms: 교체된 재조회가 진행 중
    expect(settled.a).toBe(false)
    expect(settled.b).toBe(false)

    await advance(50) // 700ms: 자료실 재조회 완료
    await Promise.all([creatingA, creatingB])
    expect(atSuccess).toEqual({ a: true, b: true }) // 각자의 성공 시점에 해당 자료실이 이미 열려 있었다
    expect(roomOpen(SEED_ZONES.REFERENCE)).toBe(true)
    expect(roomOpen(SEED_ZONES.MULTIMEDIA)).toBe(true)
    expect(roomOpen(SEED_ZONES.SOCIAL)).toBe(true) // 기존 미완료 회차가 있는 자료실은 그대로 true
    expect(roomOpen(SEED_ZONES.HUMANITIES)).toBe(true)
  })
})
