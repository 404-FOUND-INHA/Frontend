import { describe, expect, it, vi } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { createSeedData } from '@/mocks/scan/seed'
import { createScanStore } from '@/mocks/scan/store'
import type { AnalysisCounts, ScanAnalysisResponse } from '@/types/scan/analysis'
import {
  ANALYSIS_STATUS_LABEL,
  CANDIDATE_REASON_LABEL,
  STATUS_REASON_LABEL,
  getAnalysisCards,
  getAnalysisViewState,
  retryScanAnalysis,
  showsAnalysis,
  type AnalysisQuerySnapshot,
} from './scanAnalysisView'

const store = createScanStore(createSeedData())
const received = store.getAnalysis(2)
const waiting = store.getAnalysis(1)
const empty = store.getAnalysis(4)

const apiError = (status: number, code: string) => new ApiError(status, { code, message: 'x', errors: [] })
const snapshot = (patch: Partial<AnalysisQuerySnapshot> = {}): AnalysisQuerySnapshot => ({
  isPending: false,
  isError: false,
  isFetching: false,
  error: null,
  data: received,
  ...patch,
})
const state = (patch: Partial<AnalysisQuerySnapshot> = {}) => getAnalysisViewState(snapshot(patch))
const failed = { isError: true, error: new Error('network') }

describe('표시 조건', () => {
  it('REVIEW와 COMPLETED에서만 분석 결과를 보여 준다', () => {
    expect(showsAnalysis('IN_PROGRESS')).toBe(false)
    expect(showsAnalysis('REVIEW')).toBe(true)
    expect(showsAnalysis('COMPLETED')).toBe(true)
  })
})

describe('문구', () => {
  it('자동 분석 상태', () => {
    expect(ANALYSIS_STATUS_LABEL).toEqual({ NORMAL: '정상', MISPLACED: '오배치', REVIEW_REQUIRED: '검토 필요' })
  })

  it('판정 사유', () => {
    expect(STATUS_REASON_LABEL).toEqual({
      OCR_FAILED: 'OCR 인식 실패',
      NO_MATCH: '일치하는 도서 없음',
      AMBIGUOUS_MATCH: '일치하는 도서 여러 권',
      WRONG_SHELF: '다른 서가에 배치됨',
      DUPLICATE_OBSERVATION: '중복 관측',
      DISPOSED_BOOK: '제적 도서 발견',
      NO_EXPECTED_SHELF: '예상 서가 미지정',
    })
  })

  it('후보 사유', () => {
    expect(CANDIDATE_REASON_LABEL).toEqual({
      EXACT_MATCH: '청구기호 일치',
      COPY_MISMATCH: '복본기호 불일치',
      SYMBOL_ONLY: '도서기호만 일치',
      CLASSIFICATION_ONLY: '분류기호만 일치',
    })
  })
})

describe('카드', () => {
  it('네 칸을 정해진 순서와 이름으로 만든다', () => {
    expect(getAnalysisCards(received.counts)).toEqual([
      { key: 'total', label: '전체 관측', value: 128 },
      { key: 'normal', label: '정상', value: 120 },
      { key: 'misplaced', label: '오배치', value: 5 },
      { key: 'reviewRequired', label: '검토 필요', value: 3 },
    ])
  })

  it('값은 counts를 그대로 쓰며 합계를 다시 계산하지 않는다', () => {
    const inconsistent: AnalysisCounts = { total: 999, normal: 1, misplaced: 2, reviewRequired: 3 }
    expect(getAnalysisCards(inconsistent).map((c) => c.value)).toEqual([999, 1, 2, 3])
  })

  it('검토 필요를 "인식 불가"로 표시하지 않는다', () => {
    const labels = [
      ...getAnalysisCards(received.counts).map((c) => c.label),
      ...Object.values(ANALYSIS_STATUS_LABEL),
      ...Object.values(STATUS_REASON_LABEL),
    ]
    expect(labels.some((label) => label.includes('인식 불가'))).toBe(false)
  })
})

describe('영역 상태', () => {
  it('데이터가 없고 조회 중이면 로딩이다', () => {
    expect(state({ data: undefined, isPending: true, isFetching: true })).toEqual({ body: 'loading', busy: true })
  })

  it('최초 조회에 실패하면 오류다', () => {
    expect(state({ data: undefined, ...failed })).toEqual({ body: 'error', busy: false })
  })

  it('결과를 받으면 counts를 그대로 전달한다', () => {
    const view = state()
    expect(view).toEqual({ body: 'result', busy: false, refreshError: false, empty: false, counts: received.counts })
    expect(view.body === 'result' && view.counts).toBe(received.counts)
  })

  it('수신했지만 관측이 0건이면 0건 결과다', () => {
    expect(state({ data: empty })).toMatchObject({
      body: 'result',
      empty: true,
      counts: { total: 0, normal: 0, misplaced: 0, reviewRequired: 0 },
    })
  })

  it('수신 전 응답은 건수가 0이어도 0건 결과와 구분한다', () => {
    expect(state({ data: waiting })).toEqual({ body: 'notReceived', busy: false, refreshError: false })
  })

  it('회차 상태나 서가 중 하나라도 수신 전이면 결과를 보여 주지 않는다', () => {
    const inProgress: ScanAnalysisResponse = { ...received, session: { ...received.session, status: 'IN_PROGRESS' } }
    const oneWaiting: ScanAnalysisResponse = {
      ...received,
      shelves: received.shelves.map((s, i) => (i === 0 ? { ...s, scanStatus: 'WAITING' } : s)),
    }
    expect(state({ data: inProgress }).body).toBe('notReceived')
    expect(state({ data: oneWaiting }).body).toBe('notReceived')
  })

  it.each([
    ['결과', received, 'result'],
    ['0건 결과', empty, 'result'],
    ['수신 전', waiting, 'notReceived'],
  ])('재조회에 실패해도 기존 %s 화면을 유지하고 오류를 알린다', (_label, data, body) => {
    expect(state({ data, ...failed })).toMatchObject({ body, refreshError: true, busy: false })
    expect(state({ data, ...failed, isFetching: true })).toMatchObject({ body, refreshError: true, busy: true })
  })

  it.each([
    ['서버 오류', apiError(500, 'COMMON_999')],
    ['다른 404', apiError(404, ERROR_CODE.SCAN_SHELF_NOT_IN_SESSION)],
  ])('%s는 캐시를 유지한다', (_label, error) => {
    expect(state({ isError: true, error }).body).toBe('result')
  })

  it('회차가 없다는 응답(404 SCAN_001)은 캐시가 있어도 이전 결과를 보여 주지 않는다', () => {
    const error = apiError(404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
    expect(state({ isError: true, error })).toEqual({ body: 'error', busy: false })
  })
})

describe('다시 시도', () => {
  it('유효한 ID는 진행 중인 요청을 취소하지 않고 다시 조회한다', () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    retryScanAnalysis(2, refetch)
    expect(refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('유효하지 않은 ID(%s)는 조회하지 않는다', (id) => {
    const refetch = vi.fn()
    retryScanAnalysis(id, refetch)
    expect(refetch).not.toHaveBeenCalled()
  })
})
