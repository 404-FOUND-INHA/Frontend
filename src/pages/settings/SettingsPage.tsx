import { useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Page from '@/components/common/Page'
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircleIcon,
  CheckIcon,
  EqualsIcon,
  LockIcon,
  RotateCcwIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  UserIcon,
} from '@/components/common/icons'
import { useDisposalPreviewScores } from '@/hooks/evaluation/useDisposalPreviewScores'
import { useEvaluationSettings } from '@/hooks/evaluation/useEvaluationSettings'
import { useUpdateEvaluationSettings } from '@/hooks/evaluation/useUpdateEvaluationSettings'
import { CRITERION_TYPES, type CriterionType, type EvaluationSettingsResponse } from '@/types/evaluation/settings'
import SettingsSaveDialog from './SettingsSaveDialog'
import {
  CRITERION_LABEL,
  DEFAULT_DRAFT,
  countDisposalCandidates,
  diffDraft,
  formatConfiguredDate,
  isSameDraft,
  previewDeltaText,
  saveButtonState,
  saveErrorText,
  toDraft,
  toRequest,
  weightSum,
  weightSumLabel,
  type SettingsDraft,
} from './settingsView'
import './settings.css'

/** 채워진 비율을 CSS 변수로 넘겨 트랙 앞부분을 칠한다. */
const fill = (value: number): CSSProperties => ({ '--fill': `${value}%` }) as CSSProperties

// 폐기 검토 후보 기준 설정. 편집 중인 값(edits)이 없으면 서버 값을 그대로 보여 준다.
/** 헤더(뒤로 가기, 내 정보)를 갖춘 설정 화면 틀 */
function SettingsFrame({ footer, children }: { footer?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <Page
      title="설정"
      tone="gray"
      onBack={() => navigate('/')}
      right={
        // 아직 연결된 기능이 없는 버튼: 동작하지 않도록 disabled
        <button type="button" className="pg-action" disabled aria-label="내 정보 (준비 중)">
          <UserIcon size={18} />
        </button>
      }
      footer={footer}
    >
      {children}
    </Page>
  )
}

// 폐기 검토 후보 기준 설정. 편집 중인 값(edits)이 없으면 서버 값을 그대로 보여 준다.
export default function SettingsPage() {
  const settingsQuery = useEvaluationSettings()

  if (settingsQuery.data) return <SettingsEditor settings={settingsQuery.data} />

  return (
    <SettingsFrame>
      {settingsQuery.isError ? (
        <div className="st-state">
          <p>기준 설정을 불러오지 못했습니다</p>
          <button type="button" className="st-retry" disabled={settingsQuery.isFetching} onClick={() => void settingsQuery.refetch()}>
            {settingsQuery.isFetching ? '불러오는 중…' : '다시 시도'}
          </button>
        </div>
      ) : (
        <p className="st-state">불러오는 중…</p>
      )}
    </SettingsFrame>
  )
}

function SettingsEditor({ settings }: { settings: EvaluationSettingsResponse }) {
  const saved = toDraft(settings)
  const [edits, setEdits] = useState<SettingsDraft | null>(null)
  const [lastEdited, setLastEdited] = useState<CriterionType | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const mutation = useUpdateEvaluationSettings()
  const previewQuery = useDisposalPreviewScores()

  const draft = edits ?? saved
  const dirty = !isSameDraft(draft, saved)
  const sum = weightSum(draft)
  const sumLabel = weightSumLabel(sum)
  const saveButton = saveButtonState({ dirty, sumOk: sumLabel.ok, pending: mutation.isPending })

  const books = previewQuery.data?.books
  const preview =
    books && sumLabel.ok ? { current: countDisposalCandidates(books, saved), next: countDisposalCandidates(books, draft) } : null

  const update = (next: SettingsDraft) => {
    setEdits(next)
    setSavedNotice(null)
  }
  const setThreshold = (value: number) => update({ ...draft, threshold: value })
  const setWeight = (type: CriterionType, value: number) => {
    setLastEdited(type)
    update({ ...draft, weights: { ...draft.weights, [type]: value } })
  }
  const resetToDefault = () => {
    setLastEdited(null)
    update({ threshold: DEFAULT_DRAFT.threshold, weights: { ...DEFAULT_DRAFT.weights } })
  }

  const openDialog = () => {
    mutation.reset()
    setDialogOpen(true)
  }
  const confirmSave = () => {
    if (mutation.isPending) return
    mutation.mutate(toRequest(draft), {
      onSuccess: (response) => {
        setEdits(null)
        setLastEdited(null)
        setDialogOpen(false)
        setSavedNotice(`기준을 저장했습니다 (${response.profileVersion}). 이후 실행하는 종합 평가부터 적용됩니다.`)
      },
    })
  }

  const configuredDate = formatConfiguredDate(settings.configuredAt)

  const footer = (
    <div className="st-actions">
      <button type="button" className="st-btn st-btn--ghost" disabled={isSameDraft(draft, DEFAULT_DRAFT)} onClick={resetToDefault}>
        <RotateCcwIcon size={16} />
        기본값
      </button>
      <button type="button" className="st-btn st-btn--primary" disabled={saveButton.disabled} onClick={openDialog}>
        {saveButton.locked ? <LockIcon size={16} /> : <CheckIcon size={16} />}
        {saveButton.label}
      </button>
    </div>
  )

  return (
    <SettingsFrame footer={footer}>
      <div className="st">
        <p className="st-meta">
          {settings.isDefault ? '저장된 기준이 없어 기본값을 사용 중입니다' : `적용 중인 기준 ${settings.profileVersion} · ${configuredDate ?? '-'} 저장`}
        </p>

        {savedNotice && (
          <p className="st-notice" role="status">
            <CheckCircleIcon size={16} />
            {savedNotice}
          </p>
        )}

        <section className="st-card" aria-labelledby="st-threshold-title">
          <div className="st-card-head">
            <h2 id="st-threshold-title" className="st-card-title">
              기준 점수
            </h2>
            <span className="st-value-chip">
              <strong>{draft.threshold}</strong> 점
            </span>
          </div>
          <input
            type="range"
            className="st-range"
            min={0}
            max={100}
            step={1}
            value={draft.threshold}
            style={fill(draft.threshold)}
            aria-labelledby="st-threshold-title"
            aria-valuetext={`${draft.threshold}점`}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
          <div className="st-scale" aria-hidden="true">
            <span>0점 (완화)</span>
            <span>50점 (보통)</span>
            <span>100점 (엄격)</span>
          </div>
          <p className="st-help">종합 점수가 기준 점수 이상인 도서를 폐기 검토 후보로 선정합니다.</p>
        </section>

        <section className="st-card" aria-labelledby="st-weights-title">
          <div className="st-card-head">
            <h2 id="st-weights-title" className="st-card-title">
              축별 가중치
            </h2>
            <span className={sumLabel.ok ? 'st-sum st-sum--ok' : 'st-sum st-sum--error'} aria-live="polite">
              {sumLabel.ok && <CheckCircleIcon size={14} />}
              {sumLabel.text}
            </span>
          </div>
          {!sumLabel.ok && (
            <p className="st-alert" role="alert">
              <AlertTriangleIcon size={18} />
              가중치 합계가 100%가 되도록 조정해 주세요.
            </p>
          )}
          <ul className="st-weights">
            {CRITERION_TYPES.map((type) => {
              const { name, hint } = CRITERION_LABEL[type]
              const value = draft.weights[type]
              const id = `st-weight-${type}`
              const highlighted = !sumLabel.ok && lastEdited === type
              return (
                <li key={type} className={highlighted ? 'st-weight st-weight--error' : 'st-weight'}>
                  <div className="st-weight-head">
                    <label htmlFor={id} className="st-weight-name">
                      {name} <span className="st-weight-hint">({hint})</span>
                    </label>
                    <span className="st-weight-value">
                      <strong>{value}</strong>%
                    </span>
                  </div>
                  <input
                    id={id}
                    type="range"
                    className="st-range st-range--thin"
                    min={0}
                    max={100}
                    step={5}
                    value={value}
                    style={fill(value)}
                    aria-valuetext={`${value}%`}
                    onChange={(e) => setWeight(type, Number(e.target.value))}
                  />
                </li>
              )
            })}
          </ul>
        </section>

        <PreviewCard
          zone={previewQuery.data?.zone ?? null}
          preview={preview}
          sumOk={sumLabel.ok}
          loading={previewQuery.isPending}
          error={previewQuery.isError}
          retrying={previewQuery.isFetching}
          onRetry={() => void previewQuery.refetch()}
        />

        {dialogOpen && (
          <SettingsSaveDialog
            changes={diffDraft(saved, draft)}
            preview={preview}
            pending={mutation.isPending}
            errorText={mutation.isError ? saveErrorText(mutation.error, navigator.onLine) : null}
            onCancel={() => setDialogOpen(false)}
            onConfirm={confirmSave}
          />
        )}
      </div>
    </SettingsFrame>
  )
}

interface PreviewCardProps {
  zone: string | null
  preview: { current: number; next: number } | null
  sumOk: boolean
  loading: boolean
  error: boolean
  retrying: boolean
  onRetry: () => void
}

function PreviewCard({ zone, preview, sumOk, loading, error, retrying, onRetry }: PreviewCardProps) {
  const title = zone ? `예상 폐기 후보 (${zone})` : '예상 폐기 후보'

  if (!sumOk) {
    return (
      <section className="st-card st-preview" aria-label={title}>
        <div className="st-card-head">
          <h2 className="st-preview-title">{title}</h2>
          <span className="st-preview-na">산출 불가</span>
        </div>
        <p className="st-preview-error">
          <BanIcon size={18} />
          가중치 합계 오류로 미리보기를 산출할 수 없습니다.
        </p>
      </section>
    )
  }

  if (loading || error || !preview) {
    return (
      <section className="st-card st-preview" aria-label={title}>
        <h2 className="st-preview-title">{title}</h2>
        {error ? (
          <div className="st-preview-row">
            <span className="st-preview-muted">예상 영향을 불러오지 못했습니다</span>
            <button type="button" className="st-retry" disabled={retrying} onClick={onRetry}>
              {retrying ? '불러오는 중…' : '다시 시도'}
            </button>
          </div>
        ) : (
          <p className="st-preview-muted">계산 중…</p>
        )}
      </section>
    )
  }

  const delta = preview.next - preview.current
  const Icon = delta === 0 ? EqualsIcon : delta > 0 ? TrendingUpIcon : TrendingDownIcon
  return (
    <section className="st-card st-preview" aria-label={title}>
      <div className="st-preview-row">
        <div>
          <h2 className="st-preview-title">{title}</h2>
          <p className="st-preview-count" aria-live="polite">
            <strong>{preview.next}권</strong>{' '}
            <span className={delta === 0 ? 'st-preview-delta' : 'st-preview-delta st-preview-delta--changed'}>
              {delta === 0 ? previewDeltaText(preview.current, preview.next) : `현재 ${preview.current}권 대비 ${previewDeltaText(preview.current, preview.next)}`}
            </span>
          </p>
        </div>
        <span className={delta === 0 ? 'st-preview-icon' : 'st-preview-icon st-preview-icon--changed'} aria-hidden="true">
          <Icon size={22} />
        </span>
      </div>
    </section>
  )
}
