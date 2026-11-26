import { useScanAnalysis } from '@/hooks/scan/useScanAnalysis'
import { ANALYSIS_COUNT_UNIT, getAnalysisCards, getAnalysisViewState, retryScanAnalysis } from './scanAnalysisView'
import './scanDetail.css'
import './scanAnalysis.css'

/**
 * 회차의 자동 분석 결과(전체 관측·정상·오배치·검토 필요). 로딩과 오류는 이 영역 안에서만 표시한다.
 * 이 컴포넌트를 마운트하면 조회가 시작되므로, 분석이 끝난 회차에서만 렌더링한다. (showsAnalysis)
 */
export default function ScanAnalysisSection({ sessionId }: { sessionId: number }) {
  const query = useScanAnalysis(sessionId)
  const view = getAnalysisViewState({
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    error: query.error,
    data: query.data,
  })
  const refreshError = (view.body === 'result' || view.body === 'notReceived') && view.refreshError

  const retryButton = (
    <button
      type="button"
      className="scan-detail-btn"
      disabled={view.busy}
      onClick={() => retryScanAnalysis(sessionId, query.refetch)}
    >
      {view.busy ? '불러오는 중…' : '다시 시도'}
    </button>
  )

  return (
    <section className="scan-analysis" aria-label="자동 분석 결과">
      <p className="scan-section-title">자동 분석 결과</p>

      {view.body === 'loading' && (
        <p className="scan-analysis-state" role="status">
          분석 결과를 불러오는 중…
        </p>
      )}

      {view.body === 'error' && (
        <div className="scan-analysis-state" role="alert">
          <p>분석 결과를 불러오지 못했습니다.</p>
          {retryButton}
        </div>
      )}

      {refreshError && (
        <div className="scan-detail-notice" role="alert">
          <span>분석 결과를 새로 불러오지 못했습니다.</span>
          {retryButton}
        </div>
      )}

      {view.body === 'notReceived' && (
        <div className="scan-analysis-state">
          <p>분석 결과가 아직 없습니다.</p>
          {/* 재조회 오류 안내에 버튼이 있으면 하나만 둔다. */}
          {!view.refreshError && retryButton}
        </div>
      )}

      {view.body === 'result' && (
        <>
          <dl className="scan-analysis-cards">
            {getAnalysisCards(view.counts).map((card) => (
              <div key={card.key} className={`scan-analysis-card scan-analysis-card--${card.key}`}>
                <dt>{card.label}</dt>
                <dd>
                  <strong>{card.value}</strong>
                  <span>{ANALYSIS_COUNT_UNIT}</span>
                </dd>
              </div>
            ))}
          </dl>
          {view.empty && <p className="scan-analysis-empty">자동 분석에서 관측된 도서가 없습니다.</p>}
        </>
      )}
    </section>
  )
}
