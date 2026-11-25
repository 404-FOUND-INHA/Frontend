import { describe, expect, it } from 'vitest'
import {
  STATUS_FILTERS,
  formatSessionDate,
  formatSessionLocation,
  getListViewState,
  parseStatusFilter,
  type ListQuerySnapshot,
} from './scanListView'
import { scanKeys } from '@/hooks/scan/queryKeys'

describe('parseStatusFilter', () => {
  it('파라미터가 없으면 전체', () => expect(parseStatusFilter([])).toBe('all'))
  it.each(['in-progress', 'review', 'completed'] as const)('%s를 인식한다', (key) => {
    expect(parseStatusFilter([key])).toBe(key)
  })
  it.each(['foo', '', 'IN_PROGRESS', 'Review', 'all'])('지원하지 않는 값 "%s"는 전체', (value) => {
    expect(parseStatusFilter([value])).toBe('all')
  })
  it('status가 여러 번 지정되면 전체', () => {
    expect(parseStatusFilter(['review', 'completed'])).toBe('all')
    expect(parseStatusFilter(['review', 'review'])).toBe('all')
  })
  it('URLSearchParams.getAll과 함께 쓴다', () => {
    expect(parseStatusFilter(new URLSearchParams('status=review&status=completed').getAll('status'))).toBe('all')
    expect(parseStatusFilter(new URLSearchParams('x=1&status=completed').getAll('status'))).toBe('completed')
  })
})

describe('STATUS_FILTERS', () => {
  it('화면 표시와 API 조건이 맞다', () => {
    expect(STATUS_FILTERS.map((f) => [f.label, f.statuses])).toEqual([
      ['전체', undefined],
      ['진행 중', ['IN_PROGRESS']],
      ['검토 중', ['REVIEW']],
      ['완료', ['COMPLETED']],
    ])
  })
  it('전체는 상태 조건이 없는 캐시 키가 된다', () => {
    expect(scanKeys.sessionList(STATUS_FILTERS[0].statuses, 20)[3]).toEqual({ status: [], size: 20 })
  })
})

describe('formatSessionDate', () => {
  const base = { status: 'IN_PROGRESS' as const, startedAt: '2026-11-02T09:00:00', finalizedAt: null, createdAt: '2026-11-01T08:00:00' }
  it('진행 중·검토 중은 startedAt 기준 시작', () => {
    expect(formatSessionDate(base)).toBe('2026.11.02 시작')
    expect(formatSessionDate({ ...base, status: 'REVIEW' })).toBe('2026.11.02 시작')
  })
  it('완료는 finalizedAt 기준 완료', () => {
    expect(formatSessionDate({ ...base, status: 'COMPLETED', finalizedAt: '2026-06-20T17:30:00' })).toBe('2026.06.20 완료')
  })
  it('완료인데 finalizedAt이 없으면 완료 날짜를 만들지 않고 시작으로 표시', () => {
    expect(formatSessionDate({ ...base, status: 'COMPLETED' })).toBe('2026.11.02 시작')
  })
  it('startedAt이 없으면 createdAt을 "생성"으로 표시', () => {
    expect(formatSessionDate({ ...base, startedAt: null })).toBe('2026.11.01 생성')
  })
  it('유효한 날짜가 없으면 null', () => {
    expect(formatSessionDate({ ...base, startedAt: null, createdAt: '' })).toBeNull()
    expect(formatSessionDate({ ...base, startedAt: '2026-02-30T09:00:00', createdAt: 'invalid' })).toBeNull()
  })
  it('시간대 변환 없이 문자열 날짜를 그대로 쓴다(자정 경계)', () => {
    expect(formatSessionDate({ ...base, startedAt: '2026-11-02T00:00:00' })).toBe('2026.11.02 시작')
    expect(formatSessionDate({ ...base, startedAt: '2026-11-02T23:59:59' })).toBe('2026.11.02 시작')
  })
})

describe('formatSessionLocation', () => {
  it('층이 있으면 함께 표시', () => expect(formatSessionLocation({ zone: '인문과학정보실', floorNo: 3 })).toBe('인문과학정보실 (3층)'))
  it('층이 없으면 자료실명만', () => expect(formatSessionLocation({ zone: '멀티미디어실', floorNo: null })).toBe('멀티미디어실'))
  it('자료실이 없으면 null', () => expect(formatSessionLocation({ zone: null, floorNo: 3 })).toBeNull())
})

describe('getListViewState', () => {
  const idle: ListQuerySnapshot = {
    isPending: false, isError: false, isFetching: false, isFetchingNextPage: false,
    isFetchNextPageError: false, hasNextPage: false, itemCount: 5,
  }
  const state = (patch: Partial<ListQuerySnapshot>) => getListViewState({ ...idle, ...patch })

  it('최초 로딩', () => expect(state({ isPending: true, isFetching: true, itemCount: 0 }).body).toBe('loading'))
  it('최초 실패는 빈 목록이 아니라 오류', () => expect(state({ isError: true, itemCount: 0 }).body).toBe('error'))
  it('정상 0건은 빈 목록', () => expect(state({ itemCount: 0 }).body).toBe('empty'))
  it('빈 목록을 재조회하다 실패하면 빈 목록으로 가리지 않고 오류', () => {
    expect(state({ isError: true, itemCount: 0 }).body).toBe('error')
    expect(state({ isError: true, isFetching: true, itemCount: 0 })).toMatchObject({ body: 'error', busy: true })
  })
  it('정상 목록과 더보기', () => {
    expect(state({ hasNextPage: true })).toMatchObject({ body: 'list', showMore: true, busy: false })
    expect(state({ hasNextPage: false }).showMore).toBe(false)
  })
  it('다음 페이지 조회 중: 목록 유지, 버튼 비활성·로딩', () => {
    expect(state({ hasNextPage: true, isFetching: true, isFetchingNextPage: true })).toMatchObject({
      body: 'list', showMore: true, moreLoading: true, busy: true, refreshing: false,
    })
  })
  it('다음 페이지 실패: 목록 유지, 더보기 대신 오류 줄', () => {
    expect(state({ hasNextPage: true, isError: true, isFetchNextPageError: true })).toMatchObject({
      body: 'list', nextPageError: true, showMore: false, refreshError: false,
    })
  })
  it('재조회 중: 목록 유지, 더보기 비활성', () => {
    expect(state({ hasNextPage: true, isFetching: true })).toMatchObject({ body: 'list', refreshing: true, busy: true, showMore: true })
  })
  it('목록이 있는 채 재조회 실패: 목록 유지 + 오류, 더보기 숨김', () => {
    expect(state({ hasNextPage: true, isError: true })).toMatchObject({ body: 'list', refreshError: true, showMore: false })
  })
})
