import {
  InfiniteQueryObserver,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { SEED_SESSION_IDS, SEED_ZONES } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import type { ScanSessionStatus } from '@/types/scan/api'
import { createScanSessionMutationOptions } from './useCreateScanSession'
import { scanKeys } from './queryKeys'
import { scanRoomsQueryOptions } from './useScanRooms'
import { scanSessionQueryOptions } from './useScanSession'
import { scanSessionsInfiniteQueryOptions } from './useScanSessions'

// 캐시 관리 로직을 테스트에서 다시 만들지 않고, 실제 훅이 사용하는 옵션과 무효화 함수를
// 실제 QueryClient와 Observer 위에서 실행해 검증한다. (React 렌더링 없이 동작)

const NOW = Date.parse('2026-11-24T03:00:00Z')

let queryClient: QueryClient
const unsubscribers: (() => void)[] = []
const observers: { hasListeners(): boolean }[] = []

beforeEach(() => {
  resetScanStore({ now: () => NOW })
  // 앱의 QueryClient 기본 옵션(staleTime 60초 등)을 그대로 쓰고, 테스트에서는 재시도만 끈다.
  const defaults = appQueryClient.getDefaultOptions()
  queryClient = new QueryClient({
    defaultOptions: { ...defaults, queries: { ...defaults.queries, retry: false } },
  })
})

afterEach(() => {
  // 정리 검증: 구독 해제, 진행 중인 요청 없음, 캐시 비움
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  for (const observer of observers.splice(0)) expect(observer.hasListeners()).toBe(false)
  expect(queryClient.isFetching()).toBe(0)
  expect(queryClient.isMutating()).toBe(0)
  queryClient.clear()
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
  expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
})

async function observeList(statuses?: ScanSessionStatus[], size = 20) {
  const observer = new InfiniteQueryObserver(queryClient, scanSessionsInfiniteQueryOptions(statuses, size))
  observers.push(observer)
  unsubscribers.push(observer.subscribe(() => {}))
  await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
  return observer
}

async function observeRooms() {
  const observer = new QueryObserver(queryClient, scanRoomsQueryOptions())
  observers.push(observer)
  unsubscribers.push(observer.subscribe(() => {}))
  await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe('success'))
  return observer
}

const firstIdOf = (observer: Awaited<ReturnType<typeof observeList>>) =>
  observer.getCurrentResult().data?.pages[0].content[0]?.id

describe('회차 목록 조회 (useInfiniteQuery 옵션)', () => {
  it('더보기로 다음 페이지를 불러오고 마지막 페이지에서 멈춘다', async () => {
    const list = await observeList()
    expect(list.getCurrentResult().hasNextPage).toBe(true)
    expect(list.getCurrentResult().data?.pages).toHaveLength(1)

    await list.fetchNextPage()

    const result = list.getCurrentResult()
    expect(result.data?.pages.map((p) => p.page)).toEqual([0, 1])
    expect(result.data?.pages.flatMap((p) => p.content)).toHaveLength(31)
    expect(result.hasNextPage).toBe(false)
  })
})

describe('조회 조건과 쿼리 키의 일치', () => {
  it('D. 옵션을 만든 뒤 원본 상태 배열을 바꿔도 쿼리 키와 실제 조회 조건이 달라지지 않는다', async () => {
    const statuses: ScanSessionStatus[] = ['REVIEW', 'IN_PROGRESS']
    const options = scanSessionsInfiniteQueryOptions(statuses, 20)
    const keyBefore = structuredClone(options.queryKey)
    expect(options.queryKey[3].status).not.toBe(statuses) // 키는 원본이 아닌 확정된 복사본을 가진다

    statuses.splice(0, statuses.length, 'COMPLETED') // 호출자가 원본 배열을 변경

    const data = await queryClient.fetchInfiniteQuery(options)
    const items = data.pages.flatMap((page) => page.content)

    expect(options.queryKey).toEqual(keyBefore)
    expect(items.map((s) => s.status).sort()).toEqual(['IN_PROGRESS', 'REVIEW', 'REVIEW', 'REVIEW']) // 키가 말하는 조건의 결과
    expect(data.pages[0].totalElements).toBe(4)
    // 결과는 원래 키 아래에 저장되고, 변경된 배열의 키로는 아무것도 저장되지 않는다
    expect(queryClient.getQueryData(keyBefore)).toEqual(data)
    expect(queryClient.getQueryCache().find({ queryKey: scanKeys.sessionList(['COMPLETED'], 20), exact: true })).toBeUndefined()
  })

  it('원본 배열에 항목을 추가해도 조회 조건이 달라지지 않는다', async () => {
    const statuses: ScanSessionStatus[] = ['IN_PROGRESS']
    const options = scanSessionsInfiniteQueryOptions(statuses)
    statuses.push('COMPLETED', 'REVIEW')

    const data = await queryClient.fetchInfiniteQuery(options)

    expect(data.pages[0].totalElements).toBe(1)
    expect(data.pages[0].content.map((s) => s.status)).toEqual(['IN_PROGRESS'])
  })
})

describe('회차 생성 후 캐시 갱신', () => {
  it('모든 상태 필터·페이지 크기의 목록과 자료실이 갱신되고, 생성 응답이 상세 캐시에 저장되며, 관련 없는 상세는 유지된다', async () => {
    // 화면에 떠 있는(active) 쿼리: 서로 다른 필터와 페이지 크기
    const all = await observeList()
    const inProgress = await observeList(['IN_PROGRESS'])
    const completed = await observeList(['COMPLETED'])
    const smallPage = await observeList(undefined, 5)
    const rooms = await observeRooms()
    // 구독자가 없는(inactive) 쿼리
    await queryClient.fetchInfiniteQuery(scanSessionsInfiniteQueryOptions(['REVIEW']))
    await queryClient.fetchInfiniteQuery(scanSessionsInfiniteQueryOptions(['IN_PROGRESS', 'REVIEW'], 50))
    // 생성과 관련 없는 기존 회차의 상세
    await queryClient.fetchQuery(scanSessionQueryOptions(SEED_SESSION_IDS.REVIEW_PARTIAL))
    const unrelatedDetail = queryClient.getQueryData(scanKeys.session(SEED_SESSION_IDS.REVIEW_PARTIAL))
    expect(unrelatedDetail).toBeDefined()

    const mutation = new MutationObserver(queryClient, createScanSessionMutationOptions(queryClient))
    const created = await mutation.mutate({ sessionName: '캐시 테스트 회차', zone: SEED_ZONES.REFERENCE })

    // 생성 응답이 상세 캐시로 저장되고, 그 캐시는 무효화되지 않는다
    expect(queryClient.getQueryData(scanKeys.session(created.id))).toEqual(created)
    expect(queryClient.getQueryState(scanKeys.session(created.id))?.isInvalidated).toBe(false)

    // 활성 쿼리는 mutation이 끝나기 전에 이미 다시 조회되어 최신 데이터를 가진다
    expect(firstIdOf(all)).toBe(created.id)
    expect(all.getCurrentResult().data?.pages[0].totalElements).toBe(32)
    expect(firstIdOf(inProgress)).toBe(created.id)
    expect(inProgress.getCurrentResult().data?.pages[0].totalElements).toBe(2)
    expect(firstIdOf(smallPage)).toBe(created.id)
    expect(smallPage.getCurrentResult().data?.pages[0].content).toHaveLength(5)
    // 새 회차가 속하지 않는 필터는 새 회차를 포함하지 않는다
    expect(completed.getCurrentResult().data?.pages[0].totalElements).toBe(27)
    expect(completed.getCurrentResult().data?.pages[0].content.map((s) => s.id)).not.toContain(created.id)
    // 자료실: 생성한 자료실만 hasOpenSession이 바뀐다
    expect(rooms.getCurrentResult().data?.find((r) => r.zone === SEED_ZONES.REFERENCE)?.hasOpenSession).toBe(true)
    expect(rooms.getCurrentResult().data?.find((r) => r.zone === SEED_ZONES.MULTIMEDIA)?.hasOpenSession).toBe(false)

    // 비활성 쿼리는 무효화 표시만 남아 다음에 사용할 때 새로 불러온다 (staleTime 60초 이내여도)
    expect(queryClient.getQueryState(scanKeys.sessionList(['REVIEW'], 20))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(scanKeys.sessionList(['IN_PROGRESS', 'REVIEW'], 50))?.isInvalidated).toBe(true)

    // 관련 없는 회차의 상세 캐시는 그대로다 (같은 참조, 무효화되지 않음)
    expect(queryClient.getQueryData(scanKeys.session(SEED_SESSION_IDS.REVIEW_PARTIAL))).toBe(unrelatedDetail)
    expect(queryClient.getQueryState(scanKeys.session(SEED_SESSION_IDS.REVIEW_PARTIAL))?.isInvalidated).toBe(false)
  })

  it('무효화된 비활성 목록은 다시 조회하면 새 회차를 포함한다', async () => {
    await queryClient.fetchInfiniteQuery(scanSessionsInfiniteQueryOptions(['IN_PROGRESS']))
    const mutation = new MutationObserver(queryClient, createScanSessionMutationOptions(queryClient))
    const created = await mutation.mutate({ sessionName: '비활성 갱신', zone: SEED_ZONES.MULTIMEDIA })

    const refetched = await queryClient.fetchInfiniteQuery(scanSessionsInfiniteQueryOptions(['IN_PROGRESS']))
    expect(refetched.pages[0].content[0].id).toBe(created.id)
  })

  it.each([
    ['미완료 회차가 있는 자료실(409)', { sessionName: '중복', zone: SEED_ZONES.HUMANITIES }, 409],
    ['입력값 오류(400)', { sessionName: '', zone: SEED_ZONES.REFERENCE }, 400],
    ['활성 서가가 없는 자료실(400)', { sessionName: '회차', zone: SEED_ZONES.ARCHIVE }, 400],
  ])('생성이 실패하면(%s) 캐시와 저장소가 바뀌지 않는다', async (_label, request, status) => {
    const all = await observeList()
    const rooms = await observeRooms()
    await queryClient.fetchInfiniteQuery(scanSessionsInfiniteQueryOptions(['REVIEW']))
    const listBefore = all.getCurrentResult().data
    const roomsBefore = rooms.getCurrentResult().data
    const storeBefore = getScanStore().snapshot()

    const mutation = new MutationObserver(queryClient, createScanSessionMutationOptions(queryClient))
    await expect(mutation.mutate(request)).rejects.toMatchObject({ status })

    // 성공 처리(setQueryData, 무효화)가 일어나지 않았다
    expect(all.getCurrentResult().data).toBe(listBefore)
    expect(rooms.getCurrentResult().data).toBe(roomsBefore)
    expect(queryClient.getQueryState(scanKeys.sessionList(undefined, 20))?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(scanKeys.sessionList(['REVIEW'], 20))?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(scanKeys.rooms())?.isInvalidated).toBe(false)
    expect(queryClient.getQueryCache().findAll({ queryKey: ['scan', 'session'] })).toHaveLength(0)
    expect(getScanStore().snapshot()).toEqual(storeBefore)
  })
})
