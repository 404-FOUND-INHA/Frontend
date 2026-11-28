import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Page from '@/components/common/Page'
import { useScanSession } from '@/hooks/scan/useScanSession'
import { formatRoomName } from '@/pages/scan/scanCreateForm'
import { getDetailViewState, parseSessionId } from '@/pages/scan/scanDetailView'
import { toDisplayDate } from '@/pages/scan/scanListView'
import { isFromDetail, scanPaths } from '@/pages/scan/scanPaths'
import type { ScanSessionResponse } from '@/types/scan/api'
import ShelfMapView, { ShelfMapActions, ShelfMapToolbar } from './ShelfMapView'
import '@/pages/scan/scanDetail.css'
import './shelfMap.css'

const BODY_MESSAGE = {
  invalid: '올바르지 않은 회차 주소입니다',
  notFound: '장서점검 회차를 찾을 수 없습니다',
  badRequest: '잘못된 요청입니다',
  error: '회차 정보를 불러오지 못했습니다',
} as const

function dateTextOf({ status, startedAt, finalizedAt }: ScanSessionResponse): string {
  if (status === 'COMPLETED') return `확정일: ${toDisplayDate(finalizedAt) ?? '날짜 없음'}`
  const label = status === 'REVIEW' ? '검토 중' : '결과 대기'
  const started = toDisplayDate(startedAt)
  return started ? `${label} · 시작 ${started}` : label
}

/** 점검 회차 상세에서 들어오는 배치도. 회차와 자료실이 고정된다. */
export default function SessionShelfMapPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sessionId } = useParams()
  const id = parseSessionId(sessionId)
  const query = useScanSession(id ?? Number.NaN)
  const view = getDetailViewState({
    idValid: id !== null,
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    hasData: query.data !== undefined,
    error: query.error,
  })
  const session = view.body === 'content' ? query.data : undefined

  const handleBack = () => {
    if (isFromDetail(location.state)) navigate(-1)
    else navigate(id === null ? scanPaths.list : scanPaths.detail(id), { replace: true })
  }

  return (
    <Page
      title="서가 배치도"
      onBack={handleBack}
      right={<ShelfMapActions />}
    >
      <div className="shelf-map">
        {view.body === 'loading' && (
          <p className="shelf-map-state" role="status">
            불러오는 중…
          </p>
        )}
        {view.body !== 'loading' && view.body !== 'content' && (
          <div className="shelf-map-state" role="alert">
            <p>{BODY_MESSAGE[view.body]}</p>
            {view.body === 'error' && (
              <button type="button" className="scan-detail-btn" disabled={view.busy} onClick={() => void query.refetch()}>
                {view.busy ? '불러오는 중…' : '다시 시도'}
              </button>
            )}
            <Link to={scanPaths.list} replace className="scan-detail-btn scan-detail-btn--ghost">
              목록으로
            </Link>
          </div>
        )}
        {session &&
          (session.zone === null ? (
            <p className="shelf-map-state">자료실 정보가 없는 회차라 배치도를 표시할 수 없습니다.</p>
          ) : (
            <>
              <ShelfMapToolbar
                room={<p className="shelf-map-room shelf-map-room--fixed">{formatRoomName({ zone: session.zone, floorNo: session.floorNo })}</p>}
                dateText={dateTextOf(session)}
              />
              <ShelfMapView
                key={session.id}
                zone={session.zone}
                basis={{ status: 'ready', session }}
                problems={
                  view.body === 'content' && view.refreshError
                    ? [{ label: '회차 정보', stale: true, retry: () => void query.refetch({ cancelRefetch: false }) }]
                    : []
                }
              />
            </>
          ))}
      </div>
    </Page>
  )
}
