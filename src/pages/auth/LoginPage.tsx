import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import logo from '@/assets/logo.png'
import './auth.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력해주세요.')
      return
    }
    setError('')
    // TODO: 로그인 API 연동 (keep 값은 로그인 상태 유지 옵션)
    navigate('/')
  }

  return (
    <div className="au">
      <div className="au-pad" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="au-brand">
          <img src={logo} width={190} alt="LibSync" />
          <p>CV 기반 스마트 장서점검 서비스</p>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <div className="au-field">
            <label className="au-label" htmlFor="email">이메일</label>
            <input id="email" className="au-input" type="email" autoComplete="email" placeholder="이메일을 입력하세요" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="au-field">
            <label className="au-label" htmlFor="pw">비밀번호</label>
            <input id="pw" className="au-input" type="password" autoComplete="current-password" placeholder="비밀번호를 입력하세요" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <label className="au-check" style={{ margin: '4px 0 24px' }}>
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            로그인 상태 유지
          </label>
          {error && <p className="au-err" style={{ margin: '-8px 0 12px' }}>{error}</p>}
          <button className="au-btn" type="submit">로그인</button>
          <div className="au-links">
            <button type="button">아이디 찾기</button>
            <i />
            <button type="button">비밀번호 재설정</button>
          </div>
        </form>

        <div className="au-bottom">
          아직 계정이 없으신가요?<Link to="/signup">회원가입</Link>
        </div>
      </div>
    </div>
  )
}
