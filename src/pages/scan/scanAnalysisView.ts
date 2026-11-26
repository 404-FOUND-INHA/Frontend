import { ERROR_CODE, isApiError } from '@/api/ApiError'
import { isRequestableId } from '@/hooks/scan/queryKeys'
import type {
  AnalysisCounts,
  CandidateReason,
  ObservationAnalysisStatus,
  ObservationStatusReason,
  ScanAnalysisResponse,
} from '@/types/scan/analysis'
import type { ScanSessionStatus } from '@/types/scan/api'

// 회차 상세의 자동 분석 결과 영역 표시 규칙(순수 함수와 문구). 화면 컴포넌트에서 분리해 단위 테스트한다.

export const ANALYSIS_STATUS_LABEL: Record<ObservationAnalysisStatus, string> = {
  NORMAL: '정상',
  MISPLACED: '오배치',
  REVIEW_REQUIRED: '검토 필요',
}

export const STATUS_REASON_LABEL: Record<ObservationStatusReason, string> = {
  OCR_FAILED: 'OCR 인식 실패',
  NO_MATCH: '일치하는 도서 없음',
  AMBIGUOUS_MATCH: '일치하는 도서 여러 권',
  WRONG_SHELF: '다른 서가에 배치됨',
  DUPLICATE_OBSERVATION: '중복 관측',
  DISPOSED_BOOK: '제적 도서 발견',
  NO_EXPECTED_SHELF: '예상 서가 미지정',
}

export const CANDIDATE_REASON_LABEL: Record<CandidateReason, string> = {
  EXACT_MATCH: '청구기호 일치',
  COPY_MISMATCH: '복본기호 불일치',
  SYMBOL_ONLY: '도서기호만 일치',
  CLASSIFICATION_ONLY: '분류기호만 일치',
}

/** 결과를 수신해 자동 분석이 끝난 회차에서만 분석 결과를 보여 주고 조회한다. */
export function showsAnalysis(status: ScanSessionStatus): boolean {
  return status === 'REVIEW' || status === 'COMPLETED'
}

export const ANALYSIS_COUNT_UNIT = '건'

const CARDS: readonly { key: keyof AnalysisCounts; label: string }[] = [
  { key: 'total', label: '전체 관측' },
  { key: 'normal', label: '정상' },
  { key: 'misplaced', label: '오배치' },
  { key: 'reviewRequired', label: '검토 필요' },
]

export interface AnalysisCard {
  key: keyof AnalysisCounts
  label: string
  value: number
}

/** 카드 4개. 값은 응답의 counts를 그대로 쓰며 화면에서 계산하지 않는다. */
export function getAnalysisCards(counts: AnalysisCounts): AnalysisCard[] {
  return CARDS.map(({ key, label }) => ({ key, label, value: counts[key] }))
}

/** useScanAnalysis 결과 중 판정에 필요한 값만 */
export interface AnalysisQuerySnapshot {
  isPending: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
  data: ScanAnalysisResponse | undefined
}

export type AnalysisViewState = { busy: boolean } & (
  | { body: 'loading' | 'error' }
  /** 결과를 아직 받지 못했다는 응답 */
  | { body: 'notReceived'; refreshError: boolean }
  /** empty: 결과를 받았지만 관측이 0건 */
  | { body: 'result'; counts: AnalysisCounts; empty: boolean; refreshError: boolean }
)

export function getAnalysisViewState(s: AnalysisQuerySnapshot): AnalysisViewState {
  const busy = s.isFetching
  // 회차가 없다는 명시적인 응답은 캐시가 있어도 이전 결과를 보여 주지 않는다. (회차 상세와 같은 정책)
  const sessionMissing =
    s.isError && isApiError(s.error) && s.error.status === 404 && s.error.code === ERROR_CODE.SCAN_SESSION_NOT_FOUND
  if (sessionMissing) return { body: 'error', busy }
  if (!s.data) return { body: s.isPending ? 'loading' : 'error', busy }

  // 캐시가 있으면 재조회에 실패해도 유지하고 오류를 함께 알린다.
  const refreshError = s.isError
  const { session, shelves, counts } = s.data
  // 수신 전 응답의 0건은 "관측 0건"이 아니다.
  if (session.status === 'IN_PROGRESS' || shelves.some((shelf) => shelf.scanStatus === 'WAITING')) {
    return { body: 'notReceived', busy, refreshError }
  }
  return { body: 'result', busy, refreshError, counts, empty: counts.total === 0 }
}

/**
 * 다시 시도. 유효하지 않은 ID는 요청하지 않는다(refetch는 enabled 조건을 무시한다).
 * cancelRefetch: false이므로 조회 중에 다시 눌러도 요청이 중복되지 않는다.
 */
export function retryScanAnalysis(
  sessionId: number,
  refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>,
): void {
  if (isRequestableId(sessionId)) void refetch({ cancelRefetch: false })
}
