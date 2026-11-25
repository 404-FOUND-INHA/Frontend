import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanKeys } from '@/hooks/scan/queryKeys'
import { scanRoomsQueryOptions } from '@/hooks/scan/useScanRooms'
import type { ScanRoomResponse } from '@/types/scan/api'
import { getRoomsSnapshot, getRoomsViewState, validateCreateForm, validateZone } from './scanCreateForm'

// 자료실 재조회 결과와 "생성 요청에 쓸 수 있는가"가 어긋나지 않는지, 실제 QueryClient·QueryObserver 위에서
// 제품의 getRoomsSnapshot·getRoomsViewState·validateCreateForm으로 확인한다. (React 렌더링 없이 동작)

const room = (zone: string, hasOpenSession: boolean): ScanRoomResponse => ({ zone, floorNo: 2, shelfCount: 2, hasOpenSession })
const FRESH = [room('참고열람실', false), room('멀티미디어실', false)]
const AFTER_CONFLICT = [room('참고열람실', true), room('멀티미디어실', false)] // 다른 사용자가 참고열람실을 먼저 점검 시작
const TODAY = '2026-11-24'

let queryClient: QueryClient
let observer: QueryObserver<ScanRoomResponse[], Error, ScanRoomResponse[], ScanRoomResponse[], readonly ['scan', 'rooms']>
let unsubscribe: () => void
let mode: 'ok' | 'fail'
let payload: ScanRoomResponse[]

beforeEach(async () => {
  mode = 'ok'
  payload = FRESH
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
  // 키와 옵션은 제품 것을 쓰고, 서버 응답만 테스트가 제어한다.
  observer = new QueryObserver(queryClient, {
    ...scanRoomsQueryOptions(),
    queryFn: async () => {
      if (mode === 'fail') throw new Error('network')
      return payload
    },
  })
  unsubscribe = observer.subscribe(() => {})
  await observer.refetch()
})

afterEach(() => {
  unsubscribe()
  queryClient.clear()
})

const dataUpdateCount = () => queryClient.getQueryState(scanKeys.rooms())?.dataUpdateCount ?? 0
function view(conflictMark: number | null) {
  const result = observer.getCurrentResult()
  const state = {
    isPending: result.isPending,
    isError: result.isError,
    isFetching: result.isFetching,
    isSuccess: result.isSuccess,
    data: result.data,
    dataUpdateCount: dataUpdateCount(),
  }
  return { result, view: getRoomsViewState(getRoomsSnapshot(state, conflictMark)), rooms: result.data ?? [] }
}
const validForm = (zone: string, rooms: readonly ScanRoomResponse[]) =>
  validateCreateForm({ name: '점검', zone, date: '', dateBadInput: false }, rooms, TODAY).valid

describe('일반 자료실 재조회 실패 (충돌과 무관)', () => {
  it('캐시된 목록이 남아 있어도 제출할 수 없고 오류 안내·재시도가 제공된다', async () => {
    expect(view(null).view.usable).toBe(true)

    mode = 'fail'
    await observer.refetch()
    const failed = view(null)
    expect(failed.result.isError).toBe(true)
    expect(failed.rooms).toEqual(FRESH) // 기존 목록은 유지
    expect(failed.view.body).toBe('list')
    expect(failed.view.refreshFailed).toBe(true) // 오류 안내 + 다시 시도 표시 대상
    expect(failed.view.usable).toBe(false) // 제출 불가
    expect(validForm('참고열람실', failed.rooms)).toBe(true) // 폼 값 자체는 유효하므로 usable이 막아야 한다

    mode = 'ok'
    await observer.refetch() // 다시 시도
    expect(view(null).view).toMatchObject({ usable: true, refreshFailed: false })
  })
})

describe('충돌 이후 자료실 재조회', () => {
  it('충돌 이전의 성공 상태만으로는 제출 제한이 풀리지 않는다', () => {
    const mark = dataUpdateCount() // 충돌을 확인한 시점
    const { view: v } = view(mark)
    expect(v.usable).toBe(false) // 캐시는 success이지만 충돌 이후의 성공이 아니다
  })

  it('재조회 실패 후 자동 재조회(재연결 등)가 성공하면 최신 목록으로 제출이 다시 가능해진다', async () => {
    const mark = dataUpdateCount()
    mode = 'fail'
    await observer.refetch() // 충돌 직후 재조회 실패
    const failed = view(mark)
    expect(failed.view).toMatchObject({ body: 'error', usable: false })

    mode = 'ok'
    payload = AFTER_CONFLICT
    await queryClient.refetchQueries({ queryKey: scanKeys.rooms() }) // 관측자가 직접 호출하지 않은 자동 재조회
    const recovered = view(mark)
    expect(recovered.view).toMatchObject({ body: 'list', usable: true, refreshFailed: false })
    // 최신 목록 기준: 충돌한 자료실은 선택할 수 없고 다른 자료실은 가능하다
    expect(validateZone('참고열람실', recovered.rooms)).toBe('open')
    expect(validForm('참고열람실', recovered.rooms)).toBe(false)
    expect(validForm('멀티미디어실', recovered.rooms)).toBe(true)
  })

  it('수동 재시도가 성공해도 같은 기준으로 풀린다', async () => {
    const mark = dataUpdateCount()
    mode = 'fail'
    await observer.refetch()
    expect(view(mark).view.usable).toBe(false)

    mode = 'ok'
    payload = AFTER_CONFLICT
    await observer.refetch()
    expect(view(mark).view).toMatchObject({ body: 'list', usable: true })
  })

  it('재조회 중에는 제출할 수 없다', async () => {
    const mark = dataUpdateCount()
    payload = AFTER_CONFLICT
    const pending = observer.refetch()
    expect(view(mark).view.usable).toBe(false)
    await pending
    expect(view(mark).view.usable).toBe(true)
  })
})
