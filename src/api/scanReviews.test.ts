import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEED_SESSION_IDS } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import { ApiError, ERROR_CODE } from './ApiError'
import { getScanReviews } from './scanReviews'
import { finalizeScanSession } from './scanSessions'

const NOW = Date.parse('2026-11-26T03:00:00Z')

beforeEach(() => {
  resetScanStore({ now: () => NOW })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('검토 조회 API', () => {
  it('조회 조건을 저장소에 그대로 전달하고 응답을 그대로 돌려준다', async () => {
    const params = { shelfId: 9, reviewed: true, page: 1, size: 2 }
    const expected = getScanStore().getReviews(SEED_SESSION_IDS.REVIEW_COMPLETE, params)
    const spy = vi.spyOn(getScanStore(), 'getReviews')

    await expect(getScanReviews(SEED_SESSION_IDS.REVIEW_COMPLETE, params)).resolves.toStrictEqual(expected)
    expect(spy).toHaveBeenCalledExactlyOnceWith(SEED_SESSION_IDS.REVIEW_COMPLETE, params)
  })

  it('조건을 생략하면 전체의 첫 페이지다', async () => {
    const response = await getScanReviews(SEED_SESSION_IDS.REVIEW_COMPLETE)
    expect(response.summary).toStrictEqual({ totalRequired: 7, reviewed: 7, remaining: 0 })
    expect(response.items).toMatchObject({ page: 0, size: 20, totalElements: 7 })
  })

  it.each([
    [999, 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND],
    [Number.NaN, 400, ERROR_CODE.INVALID_INPUT],
  ])('회차 %s의 조회 오류는 저장소의 ApiError 그대로다', async (sessionId, status, code) => {
    const error = await getScanReviews(sessionId).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, code })
  })
})

describe('회차 확정 API', () => {
  it('저장소를 확정하고 응답을 돌려준다', async () => {
    const response = await finalizeScanSession(SEED_SESSION_IDS.REVIEW_COMPLETE)
    expect(response).toMatchObject({ sessionId: 3, status: 'COMPLETED', finalizedAt: '2026-11-26T12:00:00', finalizedBy: 1 })
    expect(response.summary.missingCandidates).toBe(21)
    expect(getScanStore().getSession(3).status).toBe('COMPLETED')
  })

  it.each([
    [SEED_SESSION_IDS.REVIEW_PARTIAL, 409, ERROR_CODE.SCAN_REVIEW_INCOMPLETE],
    [SEED_SESSION_IDS.VISION_WAITING, 409, ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE],
    [999, 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND],
  ])('회차 %s의 확정 오류는 저장소의 ApiError 그대로다', async (sessionId, status, code) => {
    const before = getScanStore().snapshot()
    const error = await finalizeScanSession(sessionId).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, code })
    expect(getScanStore().snapshot()).toStrictEqual(before)
  })

  it('응답 지연이 끝난 뒤에 저장소를 읽고 바꾼다', async () => {
    vi.stubEnv('MODE', 'development')
    vi.useFakeTimers()
    const finalizing = finalizeScanSession(SEED_SESSION_IDS.REVIEW_COMPLETE)
    const reading = getScanReviews(SEED_SESSION_IDS.REVIEW_COMPLETE)
    const spy = vi.spyOn(getScanStore(), 'getReviews')

    await vi.advanceTimersByTimeAsync(299)
    expect(getScanStore().getSession(3).status).toBe('REVIEW')
    expect(spy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([finalizing, reading])
    expect(getScanStore().getSession(3).status).toBe('COMPLETED')
    expect(spy).toHaveBeenCalledOnce()
  })
})
