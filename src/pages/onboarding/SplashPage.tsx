import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import logo from '@/assets/logo.png'
import './onboarding.css'

export default function SplashPage() {
  const navigate = useNavigate()
  useEffect(() => {
    const t = setTimeout(() => navigate('/onboarding', { replace: true }), 1800)
    return () => clearTimeout(t)
  }, [navigate])

  return (
    <div className="splash">
      <img src={logo} width={232} height={70} alt="LibSync" />
      <p>CV 기반 스마트 장서점검 서비스</p>
    </div>
  )
}
