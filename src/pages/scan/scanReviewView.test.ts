import { MutationObserver, QueryClient, onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { finalizeScanSessionMutationOptions } from '@/hooks/scan/useFinalizeScanSession'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import type { ScanSessionStatus } from '@/types/scan/api'
import type { ReviewListResponse, ReviewSummary } from '@/types/scan/review'
import {
  FINALIZE_ERROR_TEXT,
  FINALIZE_GUIDE,
  describeFinalizeError,
  getFinalizeState,
  getReviewViewState,
  handleDialogCancel,
  handleDialogClose,
  requestFinalize,
  reviewProgressPercent,
  type ReviewQuerySnapshot,
  type ReviewViewState,
} from './scanReviewView'

afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

const summary = (totalRequired: number, reviewed: number): ReviewSummary => ({
  totalRequired,
  reviewed,
  remaining: totalRequired - reviewed,
})

const apiError = (status: number, code: string) => new ApiError(status, { code, message: '서버 원문', errors: [] })
const sessionMissing = apiError(404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)

describe('검토 현황 조회 상태', () => {
  const data: ReviewListResponse = {
    summary: summary(7, 5),
    items: { content: [], page: 0, size: 20, totalElements: 7, totalPages: 1 },
  }
  const snapshot = (overrides: Partial<ReviewQuerySnapshot>): ReviewQuerySnapshot => ({
    isPending: false,
    isError: false,
    isFetching: false,
    error: null,
    data,
    ...overrides,
  })

  it('건수는 목록 길이가 아니라 응답의 summary를 쓴다', () => {
    expect(getReviewViewState(snapshot({}))).toStrictEqual({
      body: 'result',
      busy: false,
      refreshError: false,
      summary: summary(7, 5),
    })
  })

  it.each<[string, Partial<ReviewQuerySnapshot>, object]>([
    ['최초 조회 중', { data: undefined, isPending: true, isFetching: true }, { body: 'loading', busy: true }],
    ['최초 조회 실패', { data: undefined, isError: true, error: new Error('x') }, { body: 'error', busy: false }],
    ['재조회 실패는 기존 값을 유지', { isError: true, error: new Error('x') }, { body: 'result', refreshError: true }],
    ['재조회 중', { isFetching: true }, { body: 'result', busy: true }],
    ['회차 없음은 기존 값을 버림', { isError: true, error: sessionMissing }, { body: 'error' }],
  ])('%s', (_label, overrides, expected) => {
    expect(getReviewViewState(snapshot(overrides))).toMatchObject(expected)
  })

  it('진행률은 검토 완료 비율이다', () => {
    expect(reviewProgressPercent(summary(8, 2))).toBe(25)
    expect(reviewProgressPercent(summary(7, 7))).toBe(100)
    expect(reviewProgressPercent(summary(0, 0))).toBe(0)
  })
})

describe('확정 가능 조건', () => {
  const result = (s: ReviewSummary, extra: { busy?: boolean; refreshError?: boolean } = {}): ReviewViewState => ({
    body: 'result',
    summary: s,
    busy: false,
    refreshError: false,
    ...extra,
  })
  const done = result(summary(7, 7))

  it.each<[string, ScanSessionStatus, ReviewViewState, boolean, boolean, string]>([
    ['모든 검토 완료', 'REVIEW', done, false, true, FINALIZE_GUIDE.done],
    ['필수 검토 0건', 'REVIEW', result(summary(0, 0)), false, true, FINALIZE_GUIDE.empty],
    ['미처리 1건', 'REVIEW', result(summary(3, 2)), false, false, FINALIZE_GUIDE.remaining],
    ['조회 중', 'REVIEW', { body: 'loading', busy: true }, false, false, FINALIZE_GUIDE.unknown],
    ['조회 실패', 'REVIEW', { body: 'error', busy: false }, false, false, FINALIZE_GUIDE.unknown],
    ['재조회 중', 'REVIEW', result(summary(7, 7), { busy: true }), false, false, FINALIZE_GUIDE.done],
    ['재조회 실패', 'REVIEW', result(summary(7, 7), { refreshError: true }), false, false, FINALIZE_GUIDE.unknown],
    ['확정 요청 진행 중', 'REVIEW', done, true, false, FINALIZE_GUIDE.done],
    ['완료 회차', 'COMPLETED', done, false, false, FINALIZE_GUIDE.done],
    ['수신 전 회차', 'IN_PROGRESS', done, false, false, FINALIZE_GUIDE.done],
  ])('%s', (_label, status, review, submitting, enabled, guide) => {
    expect(getFinalizeState({ status, review, submitting })).toStrictEqual({ enabled, guide })
  })
})

describe('확정 요청', () => {
  const createClient = () => new QueryClient()

  function setup(sessionId: number) {
    resetScanStore()
    const client = createClient()
    const observer = new MutationObserver(client, finalizeScanSessionMutationOptions(client, sessionId))
    const finalize = vi.spyOn(getScanStore(), 'finalizeSession')
    const lock = { current: false }
    const onOffline = vi.fn()
    const click = (enabled = true) =>
      requestFinalize(lock, enabled, (options) => void observer.mutate(undefined, options).catch(() => {}), onOffline)
    // mutate의 호출별 콜백은 구독자가 있을 때만 실행된다. (useMutation과 같은 조건)
    const unsubscribe = observer.subscribe(() => {})
    const settle = () => vi.waitFor(() => expect(client.isMutating()).toBe(0))
    return { client, observer, finalize, lock, onOffline, click, settle, unsubscribe }
  }

  it('같은 틱에 여러 번 눌러도 요청은 한 번이다', async () => {
    const { client, finalize, click, settle, unsubscribe } = setup(3)

    click()
    click()
    click()
    expect(client.isMutating()).toBe(1)
    await settle()

    expect(finalize).toHaveBeenCalledExactlyOnceWith(3)
    expect(getScanStore().getSession(3).status).toBe('COMPLETED')
    unsubscribe()
  })

  it('실패하면 잠금이 풀려 다시 시도할 수 있다', async () => {
    const { finalize, lock, click, settle, unsubscribe } = setup(3)
    finalize.mockImplementationOnce(() => {
      throw new Error('network')
    })

    click()
    await settle()
    await vi.waitFor(() => expect(lock.current).toBe(false))
    expect(getScanStore().getSession(3).status).toBe('REVIEW')

    click()
    await settle()
    expect(finalize).toHaveBeenCalledTimes(2)
    expect(getScanStore().getSession(3).status).toBe('COMPLETED')
    unsubscribe()
  })

  it('오프라인에서는 mutation을 만들지 않아 연결이 돌아와도 확정되지 않고, 다시 눌러야 확정한다', async () => {
    const { client, finalize, lock, onOffline, click, settle, unsubscribe } = setup(3)
    client.mount() // QueryClientProvider처럼, 연결이 돌아오면 대기 중인 mutation을 이어서 실행하게 한다.
    onlineManager.setOnline(false)

    click()
    expect(onOffline).toHaveBeenCalledOnce()
    expect(client.getMutationCache().getAll()).toEqual([])
    expect(lock.current).toBe(false)

    onlineManager.setOnline(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(finalize).not.toHaveBeenCalled()
    expect(getScanStore().getSession(3).status).toBe('REVIEW')

    click()
    await settle()
    expect(onOffline).toHaveBeenCalledOnce()
    expect(finalize).toHaveBeenCalledExactlyOnceWith(3)
    expect(getScanStore().getSession(3).status).toBe('COMPLETED')
    unsubscribe()
    client.unmount()
  })

  it('확정할 수 없는 상태에서는 요청하지 않는다', () => {
    const { client, finalize, lock, click, unsubscribe } = setup(2)
    click(false)
    expect(client.isMutating()).toBe(0)
    expect(finalize).not.toHaveBeenCalled()
    expect(lock.current).toBe(false)
    unsubscribe()
  })
})

describe('확정 모달의 닫기', () => {
  it.each([
    ['처리 중이 아니면 닫는다', false, 1],
    ['처리 중이면 닫지 않는다', true, 0],
  ])('Esc 요청: %s', (_label, pending, closed) => {
    const preventDefault = vi.fn()
    const onClose = vi.fn()
    handleDialogCancel({ preventDefault }, pending, onClose)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledTimes(closed)
  })

  it.each([
    ['처리 중에 닫히면 다시 연다', false, true, 1, 0],
    ['처리 중이 아닐 때 닫히면 화면 상태도 닫는다', false, false, 0, 1],
    ['이미 열려 있으면 늦게 온 이벤트를 무시한다', true, false, 0, 0],
  ])('닫힘: %s', (_label, open, pending, reopened, closed) => {
    const dialog = { open, showModal: vi.fn() }
    const onClose = vi.fn()
    handleDialogClose(dialog, pending, onClose)
    expect(dialog.showModal).toHaveBeenCalledTimes(reopened)
    expect(onClose).toHaveBeenCalledTimes(closed)
  })
})

describe('확정 실패 안내', () => {
  it.each([
    [apiError(409, ERROR_CODE.SCAN_REVIEW_INCOMPLETE), FINALIZE_ERROR_TEXT.incomplete],
    [apiError(409, ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE), FINALIZE_ERROR_TEXT.notFinalizable],
    [sessionMissing, FINALIZE_ERROR_TEXT.notFound],
    [apiError(500, ERROR_CODE.INTERNAL_SERVER_ERROR), FINALIZE_ERROR_TEXT.generic],
    [new Error('network'), FINALIZE_ERROR_TEXT.generic],
  ])('%s', (error, text) => {
    expect(describeFinalizeError(error)).toBe(text)
  })
})
