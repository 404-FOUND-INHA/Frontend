import type { ReactNode } from 'react'
import { ArrowLeftIcon } from './icons'
import './page.css'

interface PageProps {
  /** 헤더 가운데에 표시한다. 좌우 슬롯과 관계없이 항상 정중앙이다. */
  title: string
  /** 있으면 좌측에 뒤로가기 버튼을 표시한다. */
  onBack?: () => void
  /** 헤더 우측 액션 영역 */
  right?: ReactNode
  /** 본문 스크롤 영역 아래(하단 탭 바로 위)에 고정되는 영역. 예: 생성 화면의 CTA */
  footer?: ReactNode
  /** 'gray'이면 본문 배경을 옅은 회색(#f8f9fa)으로 한다. 헤더는 흰색 그대로다. 목록 화면용. */
  tone?: 'gray'
  children?: ReactNode
}

/** 고정 헤더 + 본문만 스크롤 + 선택적 고정 하단 영역. 하단 탭은 MainLayout이 맡는다. */
export default function Page({ title, onBack, right, footer, tone, children }: PageProps) {
  return (
    <div className={tone === 'gray' ? 'pg pg--gray' : 'pg'}>
      <header className="pg-header">
        {onBack && (
          <button type="button" className="pg-back" onClick={onBack} aria-label="뒤로 가기">
            <ArrowLeftIcon size={20} />
          </button>
        )}
        <h1 className="pg-title">{title}</h1>
        {right && <div className="pg-right">{right}</div>}
      </header>
      <div className="pg-scroll">{children}</div>
      {footer && <div className="pg-footer">{footer}</div>}
    </div>
  )
}
