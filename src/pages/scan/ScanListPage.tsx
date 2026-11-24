import Page from '@/components/common/Page'
import { UserIcon } from '@/components/common/icons'

// 장서점검 회차 목록. 지금은 공통 레이아웃과 라우트 연결만 한 껍데기이고, 목록 콘텐츠는 3단계에서 채운다.
export default function ScanListPage() {
  return (
    <Page
      title="장서점검 기록"
      right={
        // 아직 연결된 기능이 없는 버튼: 동작하지 않도록 disabled
        <button type="button" className="pg-action" disabled aria-label="내 정보 (준비 중)">
          <UserIcon size={18} />
        </button>
      }
    />
  )
}
