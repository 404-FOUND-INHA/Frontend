import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import './auth.css'

type Role = 'librarian' | 'student'
const ROOMS = ['인문과학정보실', '사회과학정보실', '자연과학정보실', '정기간행물실']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PW_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

export default function SignupPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [role, setRole] = useState<Role>('librarian')
  const [room, setRoom] = useState('')
  const [agree, setAgree] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const errors = {
    name: name.trim() ? '' : '이름을 입력해주세요.',
    email: EMAIL_RE.test(email) ? '' : '올바른 이메일 형식이 아니에요.',
    pw: PW_RE.test(pw) ? '' : '영문, 숫자 포함 8자 이상으로 입력해주세요.',
    pw2: pw2 && pw === pw2 ? '' : '비밀번호가 일치하지 않아요.',
    agree: agree ? '' : '약관에 동의해주세요.',
  }
  const show = (k: keyof typeof errors) => (submitted && errors[k] ? errors[k] : '')

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) return
    // TODO: 회원가입 API 연동 ({ name, email, password: pw, role, room })
    navigate('/signup/complete', { replace: true })
  }

  const field = (k: keyof typeof errors, label: string, input: React.ReactNode) => (
    <div className="au-field">
      <label className="au-label" htmlFor={k}>{label}<em>*</em></label>
      {input}
      {show(k) && <p className="au-err">{show(k)}</p>}
    </div>
  )

  return (
    <div className="au">
      <header className="au-head">
        <button type="button" aria-label="뒤로가기" onClick={() => navigate(-1)}>←</button>
        <h1>회원가입</h1>
      </header>
      <form className="au-form" onSubmit={onSubmit} noValidate>
        {field('name', '이름', <input id="name" className={'au-input' + (show('name') ? ' err' : '')} autoComplete="name" placeholder="이름을 입력하세요" value={name} onChange={(e) => setName(e.target.value)} />)}
        {field('email', '이메일', <input id="email" type="email" className={'au-input' + (show('email') ? ' err' : '')} autoComplete="email" placeholder="예: librarian@library.ac.kr" value={email} onChange={(e) => setEmail(e.target.value)} />)}
        {field('pw', '비밀번호', <input id="pw" type="password" className={'au-input' + (show('pw') ? ' err' : '')} autoComplete="new-password" placeholder="영문, 숫자 포함 8자 이상" value={pw} onChange={(e) => setPw(e.target.value)} />)}
        {field('pw2', '비밀번호 확인', <input id="pw2" type="password" className={'au-input' + (show('pw2') ? ' err' : '')} autoComplete="new-password" placeholder="비밀번호를 한 번 더 입력하세요" value={pw2} onChange={(e) => setPw2(e.target.value)} />)}

        <div className="au-field">
          <span className="au-label">역할<em>*</em></span>
          <div className="au-seg">
            <button type="button" className={role === 'librarian' ? 'on' : ''} aria-pressed={role === 'librarian'} onClick={() => setRole('librarian')}>사서</button>
            <button type="button" className={role === 'student' ? 'on' : ''} aria-pressed={role === 'student'} onClick={() => setRole('student')}>근로 학생</button>
          </div>
        </div>

        <div className="au-field">
          <label className="au-label" htmlFor="room">담당 자료실<small>(선택)</small></label>
          <div className="au-select">
            <select id="room" className="au-input" value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">자료실을 선택하세요</option>
              {ROOMS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <label className="au-check" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>서비스 이용약관 및 개인정보 처리방침 동의 <b>(필수)</b></span>
        </label>
        {show('agree') && <p className="au-err">{show('agree')}</p>}

        <div className="au-spacer" />
        <button className="au-btn" type="submit">가입하기</button>
      </form>
    </div>
  )
}
