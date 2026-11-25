import { CalendarIcon, CheckCircleIcon, MapPinIcon } from '@/components/common/icons'
import type { ScanSessionResponse } from '@/types/scan/api'
import { DETAIL_STATUS_LABEL, getDateRows } from './scanDetailView'
import { formatSessionLocation } from './scanListView'
import './scanBadge.css'

const BADGE_CLASS = {
  IN_PROGRESS: 'scan-badge--in-progress',
  REVIEW: 'scan-badge--review',
  COMPLETED: 'scan-badge--completed',
} as const

/** 회차 요약: 상태 배지, 자료실, 회차명, 날짜 행 */
export default function ScanSessionSummary({ session }: { session: ScanSessionResponse }) {
  const location = formatSessionLocation(session)
  const dates = getDateRows(session)

  return (
    <section className="scan-summary">
      <div className="scan-summary-top">
        <span className={`scan-badge ${BADGE_CLASS[session.status]}`}>{DETAIL_STATUS_LABEL[session.status]}</span>
        {location && (
          <span className="scan-summary-place">
            <MapPinIcon size={15} />
            {location}
          </span>
        )}
      </div>
      <h2 className="scan-summary-title">{session.sessionName}</h2>
      {dates.length > 0 && (
        <ul className="scan-summary-dates">
          {dates.map((row) => (
            <li key={row.key}>
              {row.key === 'finalized' ? <CheckCircleIcon size={15} /> : <CalendarIcon size={15} />}
              {row.label}: {row.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
