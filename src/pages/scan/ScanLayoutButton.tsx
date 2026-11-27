import { ChevronRightIcon } from '@/components/common/icons'
import './scanReview.css'

/** 서가 배치도 버튼. 화면이 아직 없어 이동하지 않는다. */
export default function ScanLayoutButton() {
  return (
    <button type="button" className="scan-layout-btn" disabled>
      서가 배치도 보러가기
      <span className="scan-layout-soon">준비 중</span>
      <ChevronRightIcon size={18} />
    </button>
  )
}
