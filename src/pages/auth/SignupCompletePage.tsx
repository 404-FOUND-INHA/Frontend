import { useNavigate } from 'react-router-dom'
import icon from '@/assets/logo-icon.png'
import './auth.css'

export default function SignupCompletePage() {
  const navigate = useNavigate()
  return (
    <div className="au">
      <div className="au-done">
        <img className="au-icon" src={icon} alt="LibSync" />
        <h1>회원가입이 완료됐어요</h1>
        <p>로그인하고 LibSync로<br />장서점검을 시작해 보세요.</p>
      </div>
      <div className="au-pad" style={{ paddingBottom: 36 }}>
        <button className="au-btn" onClick={() => navigate('/login', { replace: true })}>로그인하러 가기</button>
      </div>
    </div>
  )
}
