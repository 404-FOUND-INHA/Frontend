import type { ReactElement } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ClipboardCheckIcon, DocumentListIcon, HomeIcon, SettingsIcon } from '@/components/common/icons'
import { NAV_ITEMS, getActiveNavKey, type NavKey } from './navigation'

const ICONS: Record<NavKey, ReactElement> = {
  home: <HomeIcon />,
  scan: <ClipboardCheckIcon />,
  shelf: <DocumentListIcon />,
  settings: <SettingsIcon />,
}

/** 하단 고정 탭. 활성 탭은 경로로 정하고, 아직 연결되지 않은 탭은 이동·포커스되지 않는 disabled 버튼이다. */
export default function BottomNav() {
  const { pathname } = useLocation()
  const active = getActiveNavKey(pathname)

  return (
    <nav className="app-nav" aria-label="주 메뉴">
      {NAV_ITEMS.map((item) => {
        const content = (
          <span className="app-tab-in">
            {ICONS[item.key]}
            <span className="app-tab-label">{item.label}</span>
          </span>
        )
        if (item.to === undefined) {
          return (
            <button key={item.key} type="button" className="app-tab" disabled aria-label={`${item.label} (준비 중)`}>
              {content}
            </button>
          )
        }
        const isActive = active === item.key
        return (
          <Link
            key={item.key}
            to={item.to}
            className={isActive ? 'app-tab app-tab--on' : 'app-tab'}
            aria-current={isActive ? 'page' : undefined}
          >
            {content}
          </Link>
        )
      })}
    </nav>
  )
}
