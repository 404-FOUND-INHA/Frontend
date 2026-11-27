import { ChevronRightIcon } from '@/components/common/icons'
import type { EvaluationItem } from '@/types/scan/evaluation'
import type { MissingCandidateResponse } from '@/types/scan/missingCandidate'
import { MISSING_STATUS_LABEL, formatScore, formatShelfCode } from './scanResultsView'
import './scanResults.css'

// 후보 목록 시트의 항목. 응답에 있는 값만 표시한다.

function Fields({ rows }: { rows: [label: string, value: string][] }) {
  return (
    <dl className="scan-candidate-fields">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function MissingCandidateItem({ candidate }: { candidate: MissingCandidateResponse }) {
  const { book, expectedShelfCode, consecutiveMissingCount, status } = candidate
  return (
    <li className="scan-candidate">
      <p className={`scan-candidate-status scan-candidate-status--${status.toLowerCase().replaceAll('_', '-')}`}>
        <span className="scan-sr-only">확인 상태: </span>
        {MISSING_STATUS_LABEL[status]}
      </p>
      <Fields
        rows={[
          ['도서명', book.title],
          ['등록번호', book.registrationNo],
          ['청구기호', book.callNumber],
          ['예상 서가', formatShelfCode(expectedShelfCode)],
          ['연속 미발견', `${consecutiveMissingCount}회`],
        ]}
      />
    </li>
  )
}

export function DisposalCandidateItem({ item }: { item: EvaluationItem }) {
  return (
    <li className="scan-candidate">
      <p className="scan-result-badge">폐기 검토 후보</p>
      <Fields
        rows={[
          ['도서명', item.title],
          ['등록번호', item.registrationNo],
          ['청구기호', item.callNumber],
          ['종합 평가 점수', formatScore(item.finalScore)],
          ['현재 서가', formatShelfCode(item.shelf?.shelfCode)],
        ]}
      />
      {/* 평가 근거 화면은 아직 없어 이동하지 않는다. */}
      <div className="scan-candidate-foot">
        <button type="button" className="scan-evidence-btn" disabled>
          평가 근거 보기
          <span className="scan-layout-soon">준비 중</span>
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </li>
  )
}
