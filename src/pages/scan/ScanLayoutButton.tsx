import { Link } from 'react-router-dom'
import { ChevronRightIcon } from '@/components/common/icons'
import { FROM_DETAIL_STATE, scanPaths } from './scanPaths'
import './scanReview.css'

/** 이 회차의 서가 배치도로 이동한다. */
export default function ScanLayoutButton({ sessionId }: { sessionId: number }) {
  return (
    <Link to={scanPaths.shelfMap(sessionId)} state={FROM_DETAIL_STATE} className="scan-layout-btn">
      서가 배치도 보러가기
      <ChevronRightIcon size={18} />
    </Link>
  )
}
