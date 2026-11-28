import { useScanReviews } from '@/hooks/scan/useScanReviews'
import type { ScanSessionResponse } from '@/types/scan/api'
import ScanFinalizeActions from './ScanFinalizeActions'
import ScanLayoutButton from './ScanLayoutButton'
import { getReviewViewState, retryScanReviews, reviewProgressPercent } from './scanReviewView'
import './scanDetail.css'
import './scanReview.css'

/**
 * 사서 검토 현황과, 검토 중 회차의 서가 배치도 이동·회차 확정. 검토 조회의 로딩과 오류는 이 영역 안에서만 표시한다.
 * 마운트하면 조회가 시작되므로, 분석이 끝난 회차에서만 렌더링한다. (showsReview)
 */
export default function ScanReviewSection({ session }: { session: ScanSessionResponse }) {
  const query = useScanReviews(session.id)
  const view = getReviewViewState({
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    error: query.error,
    data: query.data,
  })

  const retryButton = (
    <button
      type="button"
      className="scan-detail-btn"
      disabled={view.busy}
      onClick={() => retryScanReviews(session.id, query.refetch)}
    >
      {view.busy ? '불러오는 중…' : '다시 시도'}
    </button>
  )

  return (
    <section className="scan-review" aria-label="이상 도서 검토 현황">
      {view.body === 'result' && view.refreshError && (
        <div className="scan-detail-notice" role="alert">
          <span>검토 현황을 새로 불러오지 못했습니다.</span>
          {retryButton}
        </div>
      )}

      <div className="scan-review-card">
        <div className="scan-review-head">
          <p className="scan-review-title">이상 도서 검토 현황</p>
          {view.body === 'result' && view.summary.totalRequired > 0 && (
            <p className="scan-review-fraction">
              {view.summary.reviewed} / {view.summary.totalRequired}건
            </p>
          )}
        </div>

        {view.body === 'loading' && (
          <p className="scan-review-state" role="status">
            검토 현황을 불러오는 중…
          </p>
        )}

        {view.body === 'error' && (
          <div className="scan-review-state" role="alert">
            <p>검토 현황을 불러오지 못했습니다.</p>
            {retryButton}
          </div>
        )}

        {view.body === 'result' && (
          <>
            {view.summary.totalRequired === 0 ? (
              <p className="scan-review-none">필수 검토 대상이 없습니다.</p>
            ) : (
              <div
                className="scan-review-bar"
                role="progressbar"
                aria-label="검토 진행률"
                aria-valuemin={0}
                aria-valuemax={view.summary.totalRequired}
                aria-valuenow={view.summary.reviewed}
                aria-valuetext={`${view.summary.totalRequired}건 중 ${view.summary.reviewed}건 검토 완료`}
              >
                <span style={{ width: `${reviewProgressPercent(view.summary)}%` }} />
              </div>
            )}
            <div className="scan-review-counts">
              <span className="scan-review-done">검토 완료 {view.summary.reviewed}건</span>
              <span>미처리 {view.summary.remaining}건</span>
            </div>
          </>
        )}
      </div>

      {/* 확정한 회차의 배치도 버튼은 결과 카드 아래에 둔다. (ScanDetailPage) */}
      {session.status === 'REVIEW' && (
        <>
          <ScanLayoutButton sessionId={session.id} />
          <ScanFinalizeActions session={session} review={view} />
        </>
      )}
    </section>
  )
}
