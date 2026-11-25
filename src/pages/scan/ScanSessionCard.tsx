import { Link } from 'react-router-dom'
import { ChevronRightIcon, MapPinIcon } from '@/components/common/icons'
import type { ScanSessionResponse } from '@/types/scan/api'
import { FROM_LIST_STATE, SCAN_NAV_ENABLED, scanPaths } from './scanPaths'
import { SESSION_STATUS_LABEL, formatSessionDate, formatSessionLocation } from './scanListView'
import './scanBadge.css'

const BADGE_CLASS = {
  IN_PROGRESS: 'scan-badge--in-progress',
  REVIEW: 'scan-badge--review',
  COMPLETED: 'scan-badge--completed',
} as const

/** 회차 카드 1개. 상세 이동이 켜져 있으면 카드 전체가 링크이고, 목록에서 왔음을 router state로 알린다. */
export default function ScanSessionCard({ session }: { session: ScanSessionResponse }) {
  const date = formatSessionDate(session)
  const location = formatSessionLocation(session)
  const content = (
    <>
      <span className="scan-card-head">
        <span className="scan-card-title">{session.sessionName}</span>
        <span className="scan-card-chevron">
          <ChevronRightIcon size={18} />
        </span>
      </span>
      <span className="scan-card-meta">
        <span className={`scan-badge ${BADGE_CLASS[session.status]}`}>{SESSION_STATUS_LABEL[session.status]}</span>
        {date && <span className="scan-card-date">{date}</span>}
      </span>
      {location && (
        <span className="scan-card-place">
          <MapPinIcon size={15} />
          {location}
        </span>
      )}
    </>
  )

  return SCAN_NAV_ENABLED.detail ? (
    <Link to={scanPaths.detail(session.id)} state={FROM_LIST_STATE} className="scan-card scan-card--link">
      {content}
    </Link>
  ) : (
    <div className="scan-card">{content}</div>
  )
}
