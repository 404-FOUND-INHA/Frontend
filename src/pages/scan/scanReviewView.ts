import { onlineManager } from '@tanstack/react-query'
import { ERROR_CODE, isApiError } from '@/api/ApiError'
import { isRequestableId } from '@/hooks/scan/queryKeys'
import type { ScanSessionStatus } from '@/types/scan/api'
import type { ReviewListResponse, ReviewSummary } from '@/types/scan/review'

// 회차 상세의 사서 검토 현황과 회차 확정 영역의 표시 규칙(순수 함수와 문구). 화면 컴포넌트에서 분리해 단위 테스트한다.

/** 결과를 수신해 검토 대상이 정해진 회차에서만 검토 현황을 보여 주고 조회한다. */
export function showsReview(status: ScanSessionStatus): boolean {
  return status === 'REVIEW' || status === 'COMPLETED'
}

/** useScanReviews 결과 중 판정에 필요한 값만 */
export interface ReviewQuerySnapshot {
  isPending: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
  data: ReviewListResponse | undefined
}

export type ReviewViewState = { busy: boolean } & (
  | { body: 'loading' | 'error' }
  | { body: 'result'; summary: ReviewSummary; refreshError: boolean }
)

export function getReviewViewState(s: ReviewQuerySnapshot): ReviewViewState {
  const busy = s.isFetching
  // 회차가 없다는 명시적인 응답은 캐시가 있어도 이전 결과를 보여 주지 않는다. (분석 결과와 같은 정책)
  const sessionMissing =
    s.isError && isApiError(s.error) && s.error.status === 404 && s.error.code === ERROR_CODE.SCAN_SESSION_NOT_FOUND
  if (sessionMissing) return { body: 'error', busy }
  if (!s.data) return { body: s.isPending ? 'loading' : 'error', busy }
  // 건수는 응답의 summary를 그대로 쓴다. 목록은 한 페이지뿐이라 길이로 계산하지 않는다.
  return { body: 'result', busy, summary: s.data.summary, refreshError: s.isError }
}

/** 진행 막대의 채움 비율(0~100). 대상이 없으면 막대를 그리지 않으므로 호출하지 않는다. */
export function reviewProgressPercent({ reviewed, totalRequired }: ReviewSummary): number {
  return totalRequired > 0 ? (reviewed / totalRequired) * 100 : 0
}

/** 다시 시도. 유효하지 않은 ID는 요청하지 않고, 조회 중에 다시 눌러도 요청이 중복되지 않는다. */
export function retryScanReviews(
  sessionId: number,
  refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>,
): void {
  if (isRequestableId(sessionId)) void refetch({ cancelRefetch: false })
}

export const FINALIZE_GUIDE = {
  /** 검토 현황을 아직 모르거나 마지막 조회가 실패한 상태 */
  unknown: '검토 현황을 확인한 뒤 회차를 확정할 수 있습니다.',
  remaining: '필수 검토 완료 후 회차를 확정할 수 있습니다.',
  done: '모든 필수 검토가 완료되었습니다.',
  empty: '바로 회차를 확정할 수 있습니다.',
} as const

export interface FinalizeState {
  /** 확정을 시작할 수 있는가 (본문의 확정 버튼과 모달의 확정 버튼이 함께 쓴다) */
  enabled: boolean
  guide: string
}

/** 확정 조건: REVIEW 회차, 성공한 최신 검토 조회, 미처리 0건, 진행 중인 확정 요청 없음. 분석 조회는 보지 않는다. */
export function getFinalizeState(input: {
  status: ScanSessionStatus
  review: ReviewViewState
  /** 이 회차의 확정 요청이 진행 중인가 */
  submitting: boolean
}): FinalizeState {
  const { status, review, submitting } = input
  if (review.body !== 'result' || review.refreshError) return { enabled: false, guide: FINALIZE_GUIDE.unknown }

  const { totalRequired, remaining } = review.summary
  const guide =
    remaining > 0 ? FINALIZE_GUIDE.remaining : totalRequired === 0 ? FINALIZE_GUIDE.empty : FINALIZE_GUIDE.done
  return { enabled: status === 'REVIEW' && !review.busy && !submitting && remaining === 0, guide }
}

/**
 * 확정 요청을 한 번만 보낸다. 진행 상태(isPending)는 다음 렌더에 반영되므로, 같은 틱의 연타는 잠금으로 막는다.
 * 오프라인이면 보내지 않는다. TanStack Query는 오프라인의 mutation을 보관했다가 연결이 돌아오면 실행하는데,
 * 확정은 되돌릴 수 없으므로 연결된 상태에서 사용자가 다시 선택해야 한다. 연결 확인과 mutate 사이에는 await를 두지 않는다.
 */
export function requestFinalize(
  lock: { current: boolean },
  enabled: boolean,
  mutate: (options: { onSettled: () => void }) => void,
  onOffline: () => void,
): void {
  if (!enabled || lock.current) return
  if (!onlineManager.isOnline()) {
    onOffline()
    return
  }
  lock.current = true
  mutate({
    onSettled: () => {
      lock.current = false
    },
  })
}

/** Esc 등의 닫기 요청. 열림 상태는 화면이 관리하므로 기본 동작은 막고, 처리 중이 아닐 때만 닫는다. */
export function handleDialogCancel(event: { preventDefault(): void }, pending: boolean, onClose: () => void): void {
  event.preventDefault()
  if (!pending) onClose()
}

/**
 * 대화상자가 실제로 닫힌 뒤. 브라우저는 cancel을 막아도 Esc를 거듭 누르면 닫을 수 있으므로, 처리 중이면 다시 연다.
 * 이미 다시 열린 상태에서 늦게 도착한 이벤트는 무시한다.
 */
export function handleDialogClose(
  dialog: { open: boolean; showModal(): void },
  pending: boolean,
  onClose: () => void,
): void {
  if (dialog.open) return
  if (pending) dialog.showModal()
  else onClose()
}

export const FINALIZE_ERROR_TEXT = {
  offline: '네트워크 연결을 확인한 후 다시 시도해 주세요.',
  incomplete: '검토가 끝나지 않은 항목이 있어 확정할 수 없습니다.',
  notFinalizable: '이미 확정되었거나 확정할 수 없는 상태의 회차입니다.',
  notFound: '장서점검 회차를 찾을 수 없습니다.',
  generic: '회차를 확정하지 못했습니다. 잠시 후 다시 시도해 주세요.',
} as const

/** 확정 실패 안내. Backend 메시지 원문은 쓰지 않는다. */
export function describeFinalizeError(error: unknown): string {
  const code = isApiError(error) ? error.code : undefined
  if (code === ERROR_CODE.SCAN_REVIEW_INCOMPLETE) return FINALIZE_ERROR_TEXT.incomplete
  if (code === ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE) return FINALIZE_ERROR_TEXT.notFinalizable
  if (code === ERROR_CODE.SCAN_SESSION_NOT_FOUND) return FINALIZE_ERROR_TEXT.notFound
  return FINALIZE_ERROR_TEXT.generic
}
