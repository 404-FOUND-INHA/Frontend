import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/ApiError'
import { SESSION_STATUS_LABEL } from './scanListView'
import {
  DETAIL_STATUS_LABEL,
  getDateRows,
  getDetailViewState,
  getProgressView,
  parseSessionId,
  type DetailQuerySnapshot,
} from './scanDetailView'

describe('parseSessionId', () => {
  it('양의 정수 문자열만 숫자로 바꾼다', () => {
    expect(parseSessionId('1')).toBe(1)
    expect(parseSessionId('123')).toBe(123)
  })
  it.each(['abc', '0', '-1', '1.5', '01', '', ' 1', '1 ', '1e3', '99999999999999999999'])('"%s"는 유효하지 않다', (value) => {
    expect(parseSessionId(value)).toBeNull()
  })
  it('파라미터가 없으면 null', () => expect(parseSessionId(undefined)).toBeNull())
})

describe('상태 배지 문구', () => {
  it('상세는 IN_PROGRESS를 "결과 대기"로, 목록은 "진행 중"으로 표시한다', () => {
    expect(DETAIL_STATUS_LABEL.IN_PROGRESS).toBe('결과 대기')
    expect(SESSION_STATUS_LABEL.IN_PROGRESS).toBe('진행 중')
    expect(DETAIL_STATUS_LABEL.REVIEW).toBe(SESSION_STATUS_LABEL.REVIEW)
    expect(DETAIL_STATUS_LABEL.COMPLETED).toBe(SESSION_STATUS_LABEL.COMPLETED)
  })
})

describe('getProgressView', () => {
  it('IN_PROGRESS: Vision 현재 단계, 사서 검토 대기', () => {
    const v = getProgressView('IN_PROGRESS')
    expect(v.sectionTitle).toBe('장서점검 처리 단계')
    expect(v.steps.map((s) => s.state)).toEqual(['current', 'waiting'])
    expect(v.notice).toMatchObject({ icon: 'clock', title: '점검 결과를 기다리고 있어요' })
  })
  it('REVIEW: Vision 완료, 사서 검토 현재 단계', () => {
    const v = getProgressView('REVIEW')
    expect(v.sectionTitle).toBe('장서점검 진행 현황')
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'current'])
    expect(v.notice).toMatchObject({ icon: 'check', title: '자동 분석이 완료되었습니다', text: '사서의 이상 도서 검토를 기다리고 있습니다.' })
  })
  it('COMPLETED: 두 단계 모두 완료', () => {
    const v = getProgressView('COMPLETED')
    expect(v.sectionTitle).toBe('장서점검 진행 현황')
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'done'])
    expect(v.notice.title).toBe('장서점검이 완료되었습니다')
  })
  it('단계 제목은 항상 Vision 결과 수신 및 자동 분석 → 사서 검토', () => {
    for (const status of ['IN_PROGRESS', 'REVIEW', 'COMPLETED'] as const) {
      expect(getProgressView(status).steps.map((s) => s.title)).toEqual(['Vision 결과 수신 및 자동 분석', '사서 검토'])
    }
  })
})

describe('getDateRows', () => {
  const base = { status: 'IN_PROGRESS' as const, createdAt: '2026-11-10T09:30:00', plannedStartDate: null, finalizedAt: null }
  it('생성일: 날짜와 시간이 포함된 LocalDateTime 문자열', () => {
    expect(getDateRows(base)).toEqual([{ key: 'created', label: '생성일', text: '2026.11.10' }])
  })
  it('예정일은 입력된 경우에만 표시: YYYY-MM-DD 형식', () => {
    expect(getDateRows({ ...base, plannedStartDate: '2026-12-01' }).map((r) => [r.key, r.text])).toEqual([
      ['created', '2026.11.10'],
      ['planned', '2026.12.01'],
    ])
    expect(getDateRows(base).some((r) => r.key === 'planned')).toBe(false)
  })
  it('확정일은 완료 상태에서만, 날짜와 시간이 포함된 문자열도 처리', () => {
    const done = { ...base, status: 'COMPLETED' as const, finalizedAt: '2026-11-24T17:30:00' }
    expect(getDateRows(done).at(-1)).toEqual({ key: 'finalized', label: '확정일', text: '2026.11.24' })
    expect(getDateRows({ ...done, status: 'REVIEW' }).some((r) => r.key === 'finalized')).toBe(false)
  })
  it('완료인데 finalizedAt이 없으면 확정일을 만들지 않는다', () => {
    expect(getDateRows({ ...base, status: 'COMPLETED' }).some((r) => r.key === 'finalized')).toBe(false)
  })
  it('유효하지 않은 값은 행을 만들지 않는다', () => {
    expect(getDateRows({ ...base, createdAt: 'invalid', plannedStartDate: '2026-02-30' })).toEqual([])
  })
})

describe('getDetailViewState', () => {
  const ok: DetailQuerySnapshot = { idValid: true, isPending: false, isError: false, isFetching: false, hasData: true, error: null }
  const api = (status: number, code: string) => new ApiError(status, { code, message: 'x', errors: [] })
  const state = (patch: Partial<DetailQuerySnapshot>) => getDetailViewState({ ...ok, ...patch })

  it('유효하지 않은 ID는 조회 상태와 관계없이 안내(pending이어도 로딩이 아님)', () => {
    expect(state({ idValid: false, isPending: true, hasData: false }).body).toBe('invalid')
  })
  it('최초 로딩 / 정상', () => {
    expect(state({ isPending: true, hasData: false }).body).toBe('loading')
    expect(state({}).body).toBe('content')
  })
  it('404 SCAN_001은 존재하지 않는 회차(캐시가 있어도)', () => {
    const error = api(404, 'SCAN_001')
    expect(state({ isError: true, hasData: false, error }).body).toBe('notFound')
    expect(state({ isError: true, hasData: true, error }).body).toBe('notFound')
  })
  it('400 COMMON_001은 존재하지 않는 회차가 아니라 잘못된 요청', () => {
    expect(state({ isError: true, hasData: false, error: api(400, 'COMMON_001') }).body).toBe('badRequest')
  })
  it('기타 조회 실패는 오류(다시 시도)', () => {
    expect(state({ isError: true, hasData: false, error: api(500, 'COMMON_999') }).body).toBe('error')
    expect(state({ isError: true, hasData: false, error: new Error('network') }).body).toBe('error')
  })
  it('일반 재조회 실패는 기존 내용을 유지하고 오류 안내', () => {
    expect(state({ isError: true, error: new Error('network') })).toMatchObject({ body: 'content', refreshError: true })
    expect(state({ isError: true, error: api(500, 'COMMON_999') })).toMatchObject({ body: 'content', refreshError: true })
  })
  it('조회 중에는 다시 시도를 막는다', () => {
    expect(state({ isError: true, hasData: false, isFetching: true, error: new Error('x') }).busy).toBe(true)
  })
})
