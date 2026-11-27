import { ERROR_CODE, isApiError } from '@/api/ApiError'
import type { ScanSessionStatus } from '@/types/scan/api'
import type { EvaluationSummary } from '@/types/scan/evaluation'
import type { MissingCandidateStatus } from '@/types/scan/missingCandidate'

// 회차 상세의 최종 점검 결과(소재불명 후보)와 도서 가치평가 결과(폐기 검토 후보)의 표시 규칙(순수 함수와 문구).

/** 확정한 회차에서만 결과를 보여 주고 조회한다. */
export function showsResults(status: ScanSessionStatus): boolean {
  return status === 'COMPLETED'
}

/** 후보 조회 Hook 결과 중 판정에 필요한 값만 */
export interface ResultQuerySnapshot<T> {
  isPending: boolean
  isError: boolean
  isFetching: boolean
  isFetchNextPageError: boolean
  error: unknown
  data: T | undefined
}

export type ResultViewState<T> = { busy: boolean } & (
  | { body: 'loading' | 'error' }
  | { body: 'result'; data: T; refreshError: boolean }
)

export function getResultViewState<T>(s: ResultQuerySnapshot<T>): ResultViewState<T> {
  const busy = s.isFetching
  // 회차가 없다는 명시적인 응답은 캐시가 있어도 이전 결과를 보여 주지 않는다. (분석·검토 결과와 같은 정책)
  const sessionMissing =
    s.isError && isApiError(s.error) && s.error.status === 404 && s.error.code === ERROR_CODE.SCAN_SESSION_NOT_FOUND
  if (sessionMissing) return { body: 'error', busy }
  if (!s.data) return { body: s.isPending ? 'loading' : 'error', busy }
  // 다음 페이지 실패는 받아 둔 건수와 목록이 유효하므로 목록의 더보기 자리에서만 알린다.
  return { body: 'result', busy, data: s.data, refreshError: s.isError && !s.isFetchNextPageError }
}

export interface SheetFooterState {
  /** 다음 페이지 조회 실패 */
  nextPageError: boolean
  showMore: boolean
  moreLoading: boolean
}

export function getSheetFooterState(s: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  refreshError: boolean
}): SheetFooterState {
  return {
    nextPageError: s.isFetchNextPageError,
    // 재조회에 실패한 목록에는 다음 페이지를 이어 붙이지 않고 먼저 다시 불러온다.
    showMore: s.hasNextPage && !s.isFetchNextPageError && !s.refreshError,
    moreLoading: s.isFetchingNextPage,
  }
}

/**
 * 평가 현황의 종류.
 * none: 저장된 평가가 없다. 평가를 실행하지 않았는지, 평가할 도서가 없었는지는 응답으로 구분할 수 없다.
 * allNotEvaluable: 모든 도서가 평가 불가라 후보를 판정하지 못했다.
 * noCandidate: 판정한 도서가 있고 폐기 검토 후보는 없다.
 */
export type EvaluationOutcome = 'none' | 'allNotEvaluable' | 'noCandidate' | 'candidates'

export function getEvaluationOutcome({ total, disposalReview, notEvaluable }: EvaluationSummary): EvaluationOutcome {
  if (total === 0) return 'none'
  if (disposalReview > 0) return 'candidates'
  return notEvaluable === total ? 'allNotEvaluable' : 'noCandidate'
}

export const MISSING_STATUS_LABEL: Record<MissingCandidateStatus, string> = {
  PENDING: '확인 전',
  FOUND: '찾음',
  NOT_FOUND: '못 찾음',
  LOST_CANDIDATE: '분실 의심',
  RESOLVED: '종결',
}

/** 종합 평가 점수. 소수 둘째 자리까지 표시하고, 점수가 없으면 "-" */
export function formatScore(score: number | null): string {
  return score === null ? '-' : `${score.toFixed(2)}점`
}

export function formatShelfCode(shelfCode: string | null | undefined): string {
  return shelfCode ?? '서가 미지정'
}
