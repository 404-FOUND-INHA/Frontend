import { useNavigate, useSearchParams } from 'react-router-dom'
import Page from '@/components/common/Page'
import { useLatestCompletedSession } from '@/hooks/scan/useLatestCompletedSession'
import { useScanRooms } from '@/hooks/scan/useScanRooms'
import { formatRoomName } from '@/pages/scan/scanCreateForm'
import { toDisplayDate } from '@/pages/scan/scanListView'
import ShelfMapView, { ShelfMapActions, ShelfMapToolbar, type MapBasis, type MapProblem } from './ShelfMapView'
import './shelfMap.css'

const DATE_TEXT = { none: '점검 이력 없음', loading: '점검 이력 확인 중', error: '점검 이력 확인 실패' } as const

/** 서가 탭의 배치도. 선택한 자료실의 최근 확정 회차를 기준으로 한다. */
export default function ShelfMapPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const rooms = useScanRooms()
  const overall = useLatestCompletedSession()

  // 주소의 자료실이 없거나 목록에 없으면 가장 최근에 확정한 회차의 자료실, 그것도 없으면 첫 자료실이다.
  const requested = rooms.data?.find((r) => r.zone === params.get('zone'))
  const waitingDefault = overall.data === undefined && overall.errorUpdatedAt === 0
  const room =
    requested ??
    (waitingDefault ? undefined : (rooms.data?.find((r) => r.zone === overall.data?.zone) ?? rooms.data?.[0]))
  const latest = useLatestCompletedSession(room?.zone)

  const basis: MapBasis = latest.data
    ? { status: 'ready', session: latest.data }
    : latest.data === null
      ? { status: 'none' }
      : { status: latest.isError ? 'error' : 'loading' }

  const problems: MapProblem[] = []
  if (latest.isError) {
    problems.push({
      label: '최근 점검 회차',
      stale: latest.data !== undefined,
      retry: () => void latest.refetch({ cancelRefetch: false }),
    })
  }
  if (rooms.isError && rooms.data) {
    problems.push({ label: '자료실 목록', stale: true, retry: () => void rooms.refetch({ cancelRefetch: false }) })
  }

  // 앱 안에서 온 기록이 있을 때만 이전 화면으로 간다.
  const handleBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
    else navigate('/', { replace: true })
  }

  return (
    <Page
      title="서가 배치도"
      onBack={handleBack}
      right={<ShelfMapActions />}
    >
      <div className="shelf-map">
        {room && rooms.data ? (
          <>
            <ShelfMapToolbar
              room={
                <div className="shelf-map-select">
                  <select
                    aria-label="자료실"
                    value={room.zone}
                    onChange={(event) => setParams({ zone: event.target.value }, { replace: true })}
                  >
                    {rooms.data.map((item) => (
                      <option key={item.zone} value={item.zone}>
                        {formatRoomName(item)}
                      </option>
                    ))}
                  </select>
                  <span className="shelf-map-room" aria-hidden="true">
                    {formatRoomName(room)}
                  </span>
                </div>
              }
              dateText={
                basis.status === 'ready'
                  ? `최근 점검: ${toDisplayDate(basis.session.finalizedAt) ?? '날짜 없음'}`
                  : DATE_TEXT[basis.status]
              }
            />
            <ShelfMapView
              key={`${room.zone}:${basis.status === 'ready' ? basis.session.id : ''}`}
              zone={room.zone}
              basis={basis}
              problems={problems}
            />
          </>
        ) : rooms.data?.length === 0 ? (
          <p className="shelf-map-state">등록된 자료실이 없습니다.</p>
        ) : rooms.isError && !rooms.data ? (
          <div className="shelf-map-state" role="alert">
            <p>자료실 목록을 불러오지 못했습니다.</p>
            <button
              type="button"
              className="scan-detail-btn"
              disabled={rooms.isFetching}
              onClick={() => void rooms.refetch({ cancelRefetch: false })}
            >
              다시 시도
            </button>
          </div>
        ) : (
          <p className="shelf-map-state" role="status">
            자료실을 불러오는 중…
          </p>
        )}
      </div>
    </Page>
  )
}
