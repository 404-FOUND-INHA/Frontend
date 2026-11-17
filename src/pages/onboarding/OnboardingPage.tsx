import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { markOnboardingDone } from '@/utils/onboarding'
import './onboarding.css'

const C = { ok: '#4aa573', mis: '#f0c443', bad: '#d9534f', unk: '#1f2937', disc: '#ef8d3c' }

function Step1() {
  return (
    <>
      <div className="card">
        <div className="s1-head">
          <span className="s1-badge">분석 중</span>인문과학정보실 (3층)
        </div>
        <div className="s1-title">2026년 2학기 정기 장서점검</div>
        <div className="steps">
          <div className="step done">
            <span className="dot done">✓</span>
            <div><div className="st-t">Vision 결과 수신</div><div className="st-d">Vision 분석 수신 완료</div></div>
          </div>
          <div className="step">
            <span className="dot cur">2</span>
            <div><div className="st-t">백엔드 분석 <span className="now">현재 단계</span></div><div className="st-d">도서 매칭 및 배치 상태 판정</div></div>
          </div>
          <div className="step">
            <span className="dot">3</span>
            <div><div className="st-t mute">분석 완료</div><div className="st-d">사서 검토 및 현장 조치 가능</div></div>
          </div>
        </div>
      </div>
      <div className="info">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        Vision 결과가 도착하면 자동으로 분석이 시작돼요.
      </div>
    </>
  )
}

const shelves: [string, string[]][] = [
  ['N3-01', [C.ok]], ['N3-02', [C.mis]], ['N3-07', [C.ok]],
  ['N3-03', [C.ok]], ['N3-04', [C.mis, C.unk]], ['N3-08', [C.ok]],
  ['N3-05', [C.bad]], ['N3-06', [C.disc]], ['N3-09', [C.ok]],
]

function Step2() {
  const legend: [string, string][] = [['정상', C.ok], ['오배치', C.mis], ['소재불명', C.bad], ['인식 불가', C.unk], ['폐기 후보', C.disc]]
  return (
    <>
      <div className="legend">
        {legend.map(([n, c]) => <span key={n}><i className="sq" style={{ background: c }} />{n}</span>)}
      </div>
      <div className="grid-card">
        <div className="grid">
          {shelves.map(([id, dots]) => (
            <div key={id} className={'shelf' + (id === 'N3-04' ? ' sel' : '')}>
              <span className="flags">{dots.map((d) => <i key={d} className="sq" style={{ background: d }} />)}</span>
              {id}
            </div>
          ))}
        </div>
      </div>
      <div className="sheet">
        <div>
          <b>N3-04 서가</b>
          <small>
            <span><i className="sq" style={{ background: C.mis }} />오배치 2권</span>
            <span><i className="sq" style={{ background: C.unk }} />인식 불가 1건</span>
          </small>
        </div>
        <button className="pill" tabIndex={-1}>상세보기 ›</button>
      </div>
    </>
  )
}

function Step3() {
  return (
    <>
      <div className="stats">
        <div className="card"><span className="tag y">오배치</span><div className="big">5<small>권</small></div></div>
        <div className="card"><span className="tag g">인식 불가</span><div className="big">3<small>건</small></div></div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="row"><b style={{ fontSize: 13 }}>이상 도서 검토 현황</b><b style={{ color: 'var(--navy)' }}>5 / 8건</b></div>
        <div className="bar"><i /></div>
        <div className="row"><span style={{ color: 'var(--navy)', fontWeight: 600 }}>처리 완료 5건</span><span style={{ color: '#6b7280' }}>미처리 3건</span></div>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>조치 결과 <span className="tag" style={{ background: '#1f2937', color: '#fff', marginLeft: 4 }}>인식 불가</span></div>
        <div className="opt"><span className="radio" />검색한 도서로 식별 확정</div>
        <div className="opt on"><span className="radio" />식별 불가 (도서 미확인)</div>
        <button className="save" tabIndex={-1}>조치 결과 저장</button>
      </div>
    </>
  )
}

const steps: { stage: ReactNode; chip: string; title: ReactNode; desc: string }[] = [
  { stage: <Step1 />, chip: 'STEP 1 · Vision 결과 수신', title: <>촬영 장비가 보낸 결과를<br />자동으로 분석해요</>, desc: '점검 회차를 만들고 두면 서가 촬영 장비의 Vision 인식 결과가 전달되고, 도서 매칭과 배치 상태 판정까지 자동으로 진행돼요.' },
  { stage: <Step2 />, chip: 'STEP 2 · 서가 배치도', title: <>문제 있는 서가를<br />배치도에서 바로 찾아요</>, desc: '정상·오배치·소재불명·인식 불가·폐기 후보를 색으로 구분해 어느 서가부터 볼지 한눈에 알 수 있어요.' },
  { stage: <Step3 />, chip: 'STEP 3 · 사서 판정·점검 확정', title: <>사서가 검토하고<br />점검 회차를 확정해요</>, desc: '인식이 어려운 도서는 직접 식별해 조치를 남기세요. 검토가 끝나면 회차를 확정하고 리포트로 이어져요.' },
]

export default function OnboardingPage() {
  const [i, setI] = useState(0)
  const navigate = useNavigate()
  const last = i === steps.length - 1
  const s = steps[i]
  const finish = () => {
    markOnboardingDone()
    navigate('/', { replace: true })
  }

  return (
    <div className="ob">
      <div className="ob-top">
        {i > 0 && <button className="ob-back" aria-label="이전" onClick={() => setI(i - 1)}>←</button>}
        {!last && <button className="ob-skip" onClick={finish}>건너뛰기</button>}
        {last && <span className="ob-skip" style={{ visibility: 'hidden' }}>.</span>}
      </div>
      <div className="ob-stage">{s.stage}</div>
      <div className="ob-body">
        <span className="ob-chip">{s.chip}</span>
        <h2 className="ob-title">{s.title}</h2>
        <p className="ob-desc">{s.desc}</p>
      </div>
      <div className="ob-foot">
        <div className="ob-dots">{steps.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}</div>
        <button className="ob-next" onClick={last ? finish : () => setI(i + 1)}>{last ? '시작하기' : '다음 ›'}</button>
      </div>
    </div>
  )
}
