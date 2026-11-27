import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Page from '@/components/common/Page'
import { useScanSession } from '@/hooks/scan/useScanSession'
import ScanAnalysisSection from './ScanAnalysisSection'
import ScanLayoutButton from './ScanLayoutButton'
import ScanProgressSteps from './ScanProgressSteps'
import ScanResultsSection from './ScanResultsSection'
import ScanReviewSection from './ScanReviewSection'
import ScanSessionSummary from './ScanSessionSummary'
import { showsAnalysis } from './scanAnalysisView'
import { getDetailViewState, parseSessionId } from './scanDetailView'
import { isFromList, scanPaths } from './scanPaths'
import { showsResults } from './scanResultsView'
import { showsReview } from './scanReviewView'
import './scanDetail.css'

const BODY_MESSAGE = {
  invalid: '올바르지 않은 회차 주소입니다',
  notFound: '장서점검 회차를 찾을 수 없습니다',
  badRequest: '잘못된 요청입니다',
  error: '회차 정보를 불러오지 못했습니다',
} as const

// 장서점검 회차 상세(기본 정보, 처리 단계, 자동 분석 결과, 사서 검토 현황과 회차 확정, 확정한 회차의 최종 점검·가치평가 결과).
export default function ScanDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sessionId } = useParams()
  const id = parseSessionId(sessionId)
  // 훅은 항상 호출한다. 유효하지 않은 ID는 NaN을 넘겨 useScanSession의 enabled 조건(Number.isInteger)으로 요청을 막는다.
  const query = useScanSession(id ?? Number.NaN)
  const view = getDetailViewState({
    idValid: id !== null,
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    hasData: query.data !== undefined,
    error: query.error,
  })

  // 목록 카드로 들어왔으면 이전 목록(필터 유지)으로, 그 외(생성 성공 후, 주소 직접 입력 등)는 전체 목록(/scan)으로 이동한다.
  const handleBack = () => {
    if (isFromList(location.state)) navigate(-1)
    else navigate(scanPaths.list, { replace: true })
  }

  return (
    <Page title="점검 회차 상세" onBack={handleBack}>
      <div className="scan-detail">
        {view.body === 'loading' && <p className="scan-detail-state">불러오는 중…</p>}

        {(view.body === 'invalid' ||
          view.body === 'notFound' ||
          view.body === 'badRequest' ||
          view.body === 'error') && (
          <div className="scan-detail-state">
            <p>{BODY_MESSAGE[view.body]}</p>
            <div className="scan-detail-actions">
              {view.body === 'error' && (
                <button type="button" className="scan-detail-btn" disabled={view.busy} onClick={() => void query.refetch()}>
                  {view.busy ? '불러오는 중…' : '다시 시도'}
                </button>
              )}
              <Link to={scanPaths.list} replace className="scan-detail-btn scan-detail-btn--ghost">
                목록으로
              </Link>
            </div>
          </div>
        )}

        {view.body === 'content' && query.data && (
          <>
            {view.refreshError && (
              <div className="scan-detail-notice" role="alert">
                <span>회차 정보를 새로 불러오지 못했습니다</span>
                <button type="button" className="scan-detail-btn" disabled={view.busy} onClick={() => void query.refetch()}>
                  {view.busy ? '불러오는 중…' : '다시 시도'}
                </button>
              </div>
            )}
            <ScanSessionSummary session={query.data} />
            <ScanProgressSteps status={query.data.status} />
            {showsAnalysis(query.data.status) && <ScanAnalysisSection sessionId={query.data.id} />}
            {/* key: 다른 회차로 바뀌면 모달의 열림 상태와 확정 오류를 이어받지 않는다. */}
            {showsReview(query.data.status) && <ScanReviewSection key={query.data.id} session={query.data} />}
            {/* key: 다른 회차로 바뀌면 후보 목록의 열림 상태를 이어받지 않는다. */}
            {showsResults(query.data.status) && (
              <>
                <ScanResultsSection key={`results-${query.data.id}`} sessionId={query.data.id} />
                <ScanLayoutButton />
              </>
            )}
          </>
        )}
      </div>
    </Page>
  )
}
