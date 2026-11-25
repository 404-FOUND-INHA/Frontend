import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import './mainLayout.css'

/** 모바일 프레임: 본문(각 화면의 Page가 헤더·스크롤을 맡는다) + 고정 하단 탭 */
export default function MainLayout() {
  return (
    <div className="app">
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
