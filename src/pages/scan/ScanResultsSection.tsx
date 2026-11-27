import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from '@/components/common/icons'
import { useDisposalCandidates } from '@/hooks/scan/useDisposalCandidates'
import { useMissingCandidates } from '@/hooks/scan/useMissingCandidates'
import type { EvaluationSummary } from '@/types/scan/evaluation'
import { DisposalCandidateItem, MissingCandidateItem } from './CandidateItems'
import CandidateSheet from './CandidateSheet'
import {
  getEvaluationOutcome,
  getResultViewState,
  getSheetFooterState,
  type ResultViewState,
} from './scanResultsView'
import './scanDetail.css'
import './scanResults.css'

/**
 * 확정한 회차의 최종 점검 결과(소재불명 후보)와 도서 가치평가 결과(폐기 검토 후보).
 * 마운트하면 조회가 시작되므로 확정한 회차에서만 렌더링한다. (showsResults)
 * 회차가 바뀌면 key로 새로 마운트해 목록의 열림 상태를 이어받지 않는다.
 */
export default function ScanResultsSection({ sessionId }: { sessionId: number }) {
  return (
    <>
      <MissingResult sessionId={sessionId} />
      <DisposalResult sessionId={sessionId} />
    </>
  )
}

/** 카드와 목록 시트는 같은 조회 결과를 쓴다. */
function MissingResult({ sessionId }: { sessionId: number }) {
  const query = useMissingCandidates(sessionId)
  const view = getResultViewState(query)
  const [open, setOpen] = useState(false)
  // 결과를 보여 줄 수 없게 되면 시트를 닫는다. 결과가 돌아와도 저절로 다시 열리지 않는다.
  if (open && view.body !== 'result') setOpen(false)
  const retry = () => void query.refetch({ cancelRefetch: false })

  return (
    <ResultSection title="최종 점검 결과" subject="소재불명 후보를" view={view} onRetry={retry}>
      {({ data, refreshError }) => (
        <>
          <ResultHead badge="소재불명 후보" tone="missing" count={data.totalElements} />
          {data.totalElements === 0 ? (
            <p className="scan-result-text">소재불명 후보가 없습니다.</p>
          ) : (
            <>
              <p className="scan-result-text">최종 점검 결과를 기준으로 선정된 미발견 도서</p>
              <OpenListButton label="소재불명 후보 내역 보기" onClick={() => setOpen(true)} />
            </>
          )}
          {open && (
            <CandidateSheet
              title="소재불명 후보"
              tone="missing"
              total={data.totalElements}
              refreshError={refreshError}
              footer={getSheetFooterState({ ...query, refreshError })}
              busy={view.busy}
              onLoadMore={() => void query.loadMore()}
              onRetry={retry}
              onClose={() => setOpen(false)}
            >
              {data.candidates.map((candidate) => (
                <MissingCandidateItem key={candidate.candidateId} candidate={candidate} />
              ))}
            </CandidateSheet>
          )}
        </>
      )}
    </ResultSection>
  )
}

function DisposalResult({ sessionId }: { sessionId: number }) {
  const query = useDisposalCandidates(sessionId)
  const view = getResultViewState(query)
  const [open, setOpen] = useState(false)
  if (open && view.body !== 'result') setOpen(false)
  const retry = () => void query.refetch({ cancelRefetch: false })

  return (
    <ResultSection title="도서 가치평가 결과" subject="가치평가 결과를" view={view} onRetry={retry}>
      {({ data, refreshError }) => (
        <>
          <EvaluationResult
            summary={data.summary}
            busy={view.busy}
            // 재조회 오류 안내에 버튼이 있으면 하나만 둔다.
            onReload={refreshError ? null : retry}
            onOpen={() => setOpen(true)}
          />
          {open && (
            <CandidateSheet
              title="폐기 검토 후보"
              tone="disposal"
              total={data.summary.disposalReview}
              refreshError={refreshError}
              footer={getSheetFooterState({ ...query, refreshError })}
              busy={view.busy}
              onLoadMore={() => void query.loadMore()}
              onRetry={retry}
              onClose={() => setOpen(false)}
            >
              {data.candidates.map((item) => (
                <DisposalCandidateItem key={item.evaluationId} item={item} />
              ))}
            </CandidateSheet>
          )}
        </>
      )}
    </ResultSection>
  )
}

function EvaluationResult({
  summary,
  busy,
  onReload,
  onOpen,
}: {
  summary: EvaluationSummary
  busy: boolean
  onReload: (() => void) | null
  onOpen: () => void
}) {
  const outcome = getEvaluationOutcome(summary)
  const badge = '폐기 검토 후보'

  if (outcome === 'none') {
    return (
      <div className="scan-result-none">
        <p className="scan-result-none-title">가치평가 결과가 없습니다.</p>
        <p>평가가 실행되지 않았거나 평가할 도서가 없습니다.</p>
        {onReload && (
          <button type="button" className="scan-detail-btn" disabled={busy} onClick={onReload}>
            {busy ? '조회 중…' : '다시 조회'}
          </button>
        )}
      </div>
    )
  }

  // 모두 평가 불가이면 후보가 0권이라고 단정하지 않는다.
  if (outcome === 'allNotEvaluable') {
    return (
      <>
        <ResultHead badge={badge} tone="disposal" />
        <p className="scan-result-text">평가에 필요한 데이터가 부족하여 종합 점수를 산출할 수 없습니다.</p>
      </>
    )
  }

  return (
    <>
      <ResultHead badge={badge} tone="disposal" count={summary.disposalReview} />
      <p className="scan-result-text">
        {outcome === 'candidates' ? 'JEV 및 도서 데이터를 기반으로 선정된 폐기 검토 대상' : '폐기 검토 후보가 없습니다.'}
      </p>
      {summary.notEvaluable > 0 && <p className="scan-result-sub">일부 도서의 가치평가가 불가능합니다.</p>}
      {outcome === 'candidates' && <OpenListButton label="폐기 검토 후보 내역 보기" onClick={onOpen} />}
    </>
  )
}

/** 제목과 카드. 로딩과 오류는 이 영역 안에서만 표시한다. */
function ResultSection<T>({
  title,
  subject,
  view,
  onRetry,
  children,
}: {
  title: string
  /** 안내 문구의 목적어 */
  subject: string
  view: ResultViewState<T>
  onRetry: () => void
  children: (result: { data: T; refreshError: boolean }) => ReactNode
}) {
  const retryButton = (
    <button type="button" className="scan-detail-btn" disabled={view.busy} onClick={onRetry}>
      {view.busy ? '불러오는 중…' : '다시 시도'}
    </button>
  )

  return (
    <section className="scan-result" aria-label={title}>
      <p className="scan-section-title">{title}</p>

      {view.body === 'result' && view.refreshError && (
        <div className="scan-detail-notice" role="alert">
          <span>{subject} 새로 불러오지 못했습니다.</span>
          {retryButton}
        </div>
      )}

      <div className="scan-result-card">
        {view.body === 'loading' && (
          <p className="scan-result-state" role="status">
            {subject} 불러오는 중…
          </p>
        )}
        {view.body === 'error' && (
          <div className="scan-result-state" role="alert">
            <p>{subject} 불러오지 못했습니다.</p>
            {retryButton}
          </div>
        )}
        {view.body === 'result' && children(view)}
      </div>
    </section>
  )
}

/** 후보 종류 배지와 회차 전체의 후보 건수 */
function ResultHead({ badge, tone, count }: { badge: string; tone: 'missing' | 'disposal'; count?: number }) {
  return (
    <div className={`scan-result-head scan-result-head--${tone}`}>
      <p className="scan-result-badge">{badge}</p>
      {count !== undefined && (
        <p className="scan-result-count">
          <strong>{count}</strong>
          <span>권</span>
        </p>
      )}
    </div>
  )
}

function OpenListButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="scan-result-foot">
      {/* 두 카드의 버튼을 읽어 주는 이름으로 구분한다. */}
      <button type="button" className="scan-result-open" aria-label={label} aria-haspopup="dialog" onClick={onClick}>
        후보 내역 보기
        <ChevronRightIcon size={16} />
      </button>
    </div>
  )
}
