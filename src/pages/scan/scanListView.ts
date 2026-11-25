import type { ScanSessionResponse, ScanSessionStatus } from '@/types/scan/api'
import { isValidIsoDate } from '@/utils/calendarDate'

// 회차 목록 화면의 표시 규칙(순수 함수). 화면 컴포넌트에서 분리해 단위 테스트한다.

/** 화면 필터 키. "전체"는 API 상태값이 아니라 UI 필터다(상태 조건 없음). */
export type StatusFilterKey = 'all' | 'in-progress' | 'review' | 'completed'

export interface StatusFilter {
  key: StatusFilterKey
  label: string
  /** useScanSessions에 넘기는 API 상태 조건. 없으면 전체 */
  statuses?: readonly ScanSessionStatus[]
}

export const STATUS_FILTERS: readonly StatusFilter[] = [
  { key: 'all', label: '전체' },
  { key: 'in-progress', label: '진행 중', statuses: ['IN_PROGRESS'] },
  { key: 'review', label: '검토 중', statuses: ['REVIEW'] },
  { key: 'completed', label: '완료', statuses: ['COMPLETED'] },
]

export const STATUS_QUERY_PARAM = 'status'

/**
 * URL의 status 파라미터 값 목록(searchParams.getAll)을 필터 키로 바꾼다.
 * 파라미터가 없거나, 지원하지 않는 값이거나, 여러 번 지정되었으면 안전하게 "전체"로 처리한다.
 */
export function parseStatusFilter(values: readonly string[]): StatusFilterKey {
  if (values.length !== 1) return 'all'
  const found = STATUS_FILTERS.find((filter) => filter.key === values[0])
  return found ? found.key : 'all'
}

export const SESSION_STATUS_LABEL: Record<ScanSessionStatus, string> = {
  IN_PROGRESS: '진행 중',
  REVIEW: '검토 중',
  COMPLETED: '완료',
}

/** 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm:ss'에서 유효한 날짜를 'YYYY.MM.DD'로 만든다. 시간대 변환은 하지 않는다(LocalDateTime은 시간대 정보가 없다). */
export function toDisplayDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = value.slice(0, 10)
  if (value.length > 10 && value[10] !== 'T') return null
  if (!isValidIsoDate(date)) return null
  return date.replaceAll('-', '.')
}

/**
 * 카드 우측 날짜 문구. 필드마다 의미가 다르므로 문구를 구분한다.
 * 완료 상태의 finalizedAt → "완료", startedAt → "시작", createdAt(대체) → "생성". 유효한 날짜가 없으면 null.
 * 완료 상태라도 finalizedAt이 없으면 완료 날짜를 만들어 내지 않는다.
 */
export function formatSessionDate(
  session: Pick<ScanSessionResponse, 'status' | 'startedAt' | 'finalizedAt' | 'createdAt'>,
): string | null {
  if (session.status === 'COMPLETED') {
    const finalized = toDisplayDate(session.finalizedAt)
    if (finalized) return `${finalized} 완료`
  }
  const started = toDisplayDate(session.startedAt)
  if (started) return `${started} 시작`
  const created = toDisplayDate(session.createdAt)
  if (created) return `${created} 생성`
  return null
}

/** 자료실 문구. "인문과학정보실 (3층)". 층이 없으면 자료실명만, 자료실이 없으면 null */
export function formatSessionLocation(session: Pick<ScanSessionResponse, 'zone' | 'floorNo'>): string | null {
  if (!session.zone) return null
  return session.floorNo === null ? session.zone : `${session.zone} (${session.floorNo}층)`
}

export const EMPTY_MESSAGE: Record<StatusFilterKey, string> = {
  all: '장서점검 기록이 없습니다',
  'in-progress': '진행 중인 회차가 없습니다',
  review: '검토 중인 회차가 없습니다',
  completed: '완료된 회차가 없습니다',
}

/** useScanSessions 결과 중 화면 상태 판정에 필요한 값만 */
export interface ListQuerySnapshot {
  isPending: boolean
  isError: boolean
  isFetching: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  hasNextPage: boolean
  /** 지금까지 불러온 회차 수 */
  itemCount: number
}

export interface ListViewState {
  /** 본문 영역: 최초 로딩 / 오류(재시도) / 정상 0건 / 목록 */
  body: 'loading' | 'error' | 'empty' | 'list'
  /** 기존 목록을 유지한 채 재조회 중 */
  refreshing: boolean
  /** 기존 목록을 유지한 채 재조회에 실패(다음 페이지 실패 제외) */
  refreshError: boolean
  /** 다음 페이지 조회 실패 */
  nextPageError: boolean
  showMore: boolean
  moreLoading: boolean
  /** 더보기·다시 시도 버튼 비활성: 조회가 진행 중이면 중복 요청을 막는다 */
  busy: boolean
}

export function getListViewState(s: ListQuerySnapshot): ListViewState {
  const nextPageError = s.isFetchNextPageError
  // 데이터가 비어 있는 채로 오류이면(최초 실패, 또는 빈 결과를 재조회하다 실패) 빈 목록이 아니라 오류로 보여준다.
  const body = s.isPending ? 'loading' : s.isError && s.itemCount === 0 ? 'error' : s.itemCount === 0 ? 'empty' : 'list'
  const refreshError = body === 'list' && s.isError && !nextPageError
  return {
    body,
    refreshing: body !== 'loading' && s.isFetching && !s.isFetchingNextPage && !s.isError,
    refreshError,
    nextPageError: body === 'list' && nextPageError,
    showMore: body === 'list' && s.hasNextPage && !nextPageError && !refreshError,
    moreLoading: s.isFetchingNextPage,
    busy: s.isFetching,
  }
}
