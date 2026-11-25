import { CheckCircleIcon, CheckIcon, ClockIcon } from '@/components/common/icons'
import type { ScanSessionStatus } from '@/types/scan/api'
import { getProgressView } from './scanDetailView'

/** 처리 단계(2단계)와 안내 카드. 회차 status만으로 표시가 결정된다. */
export default function ScanProgressSteps({ status }: { status: ScanSessionStatus }) {
  const view = getProgressView(status)

  return (
    <section className="scan-progress">
      <p className="scan-section-title">{view.sectionTitle}</p>
      <ol className="scan-step-list">
        {view.steps.map((step, index) => (
          <li key={step.title} className={`scan-step scan-step--${step.state}`}>
            <span className="scan-step-mark">{step.state === 'done' ? <CheckIcon size={16} /> : index + 1}</span>
            <div className="scan-step-body">
              <div className="scan-step-head">
                <span className="scan-step-title">{step.title}</span>
                {step.state === 'current' && <span className="scan-step-tag scan-step-tag--current">현재 단계</span>}
                {step.state === 'done' && <span className="scan-step-tag scan-step-tag--done">완료</span>}
              </div>
              <p className="scan-step-desc">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="scan-notice-card">
        <span className="scan-notice-card-icon">
          {view.notice.icon === 'clock' ? <ClockIcon size={22} /> : <CheckCircleIcon size={22} />}
        </span>
        <div>
          <p className="scan-notice-card-title">{view.notice.title}</p>
          <p className="scan-notice-card-text">{view.notice.text}</p>
        </div>
      </div>
    </section>
  )
}
