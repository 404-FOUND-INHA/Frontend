import { matchPath } from 'react-router-dom'

export type NavKey = 'home' | 'scan' | 'shelf' | 'settings'

export interface NavItem {
  key: NavKey
  label: string
  /** 이동할 경로. 없으면 아직 연결되지 않은 탭이며 비활성으로 표시한다. */
  to?: string
  /** true이면 정확히 일치할 때만 활성 (홈). 아니면 하위 경로에서도 활성 */
  end?: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', label: '홈', to: '/', end: true },
  { key: 'scan', label: '점검', to: '/scan' }, // /scan, /scan/new, /scan/:sessionId 모두에서 활성
  { key: 'shelf', label: '서가', to: '/shelf' },
  { key: 'settings', label: '설정' },
]

/** 현재 경로에서 활성이어야 하는 탭. 어느 탭에도 해당하지 않으면(예: 404) null */
export function getActiveNavKey(pathname: string): NavKey | null {
  const active = NAV_ITEMS.find(
    (item) => item.to !== undefined && matchPath({ path: item.to, end: item.end ?? false }, pathname),
  )
  return active?.key ?? null
}
