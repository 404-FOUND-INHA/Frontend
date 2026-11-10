import { Outlet } from 'react-router-dom'

export default function MainLayout() {
  return (
    <div>
      {/* TODO: Header / Navigation */}
      <main>
        <Outlet />
      </main>
      {/* TODO: Footer */}
    </div>
  )
}
