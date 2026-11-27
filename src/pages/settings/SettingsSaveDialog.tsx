import { useId, useLayoutEffect, useRef } from 'react'
import { SyncCheckIcon } from '@/components/common/icons'
import { handleDialogCancel, handleDialogClose } from '@/pages/scan/scanReviewView'
import { CRITERION_LABEL, previewDeltaText, signed, type DraftChanges } from './settingsView'

interface SettingsSaveDialogProps {
  changes: DraftChanges
  /** 예상 폐기 후보 수. 산출하지 못했으면 null */
  preview: { current: number; next: number } | null
  /** 저장 요청 진행 중: 닫기와 버튼을 모두 막는다. */
  pending: boolean
  errorText: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** 기준 변경 저장 확인 모달. 열려 있는 동안만 렌더링한다. 브라우저 기본 dialog가 포커스 가두기를 맡는다. */
export default function SettingsSaveDialog({ changes, preview, pending, errorText, onCancel, onConfirm }: SettingsSaveDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    // 화면에서 제거하기 전에 닫아야 포커스가 모달을 열었던 위치로 돌아간다.
    return () => dialog.close()
  }, [])

  const { threshold, weights } = changes

  return (
    <dialog
      ref={ref}
      className="st-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-busy={pending}
      onCancel={(event) => handleDialogCancel(event, pending, onCancel)}
      onClose={(event) => handleDialogClose(event.currentTarget, pending, onCancel)}
    >
      <span className="st-dialog-icon">
        <SyncCheckIcon size={26} />
      </span>
      <h2 id={titleId} className="st-dialog-title">
        기준 변경 저장
      </h2>
      <p id={descId} className="st-dialog-desc">
        변경된 기준을 적용하시겠습니까?
      </p>

      <dl className="st-dialog-summary">
        {threshold && (
          <div>
            <dt>기준 점수</dt>
            <dd>
              {threshold.from}점 → <strong>{threshold.to}점</strong>{' '}
              <span className="st-chip-delta">({signed(threshold.to - threshold.from, '점')})</span>
            </dd>
          </div>
        )}
        {weights.length > 0 && (
          <div>
            <dt>가중치 변경</dt>
            <dd className="st-dialog-weights">
              {weights.map(({ criterion, delta }) => (
                <span key={criterion}>
                  {CRITERION_LABEL[criterion].name}{' '}
                  <strong className={delta > 0 ? 'st-plus' : 'st-minus'}>{signed(delta, '%')}</strong>
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt>예상 폐기 후보</dt>
          <dd>
            {preview ? (
              <>
                {preview.current}권 → <strong>{preview.next}권</strong>{' '}
                <strong className={preview.current === preview.next ? 'st-minus' : 'st-warn'}>{previewDeltaText(preview.current, preview.next)}</strong>
              </>
            ) : (
              '산출 불가'
            )}
          </dd>
        </div>
      </dl>

      <p className="st-dialog-note">저장한 기준은 이후 실행하는 종합 평가부터 적용되며, 이미 산출된 결과는 바뀌지 않습니다.</p>

      {errorText && !pending && (
        <p className="st-dialog-error" role="alert">
          {errorText}
        </p>
      )}

      <div className="st-dialog-actions">
        <button type="button" className="st-dialog-btn st-dialog-btn--cancel" disabled={pending} onClick={onCancel}>
          취소
        </button>
        <button type="button" className="st-dialog-btn st-dialog-btn--confirm" disabled={pending} onClick={onConfirm}>
          {pending ? '저장 중…' : '저장'}
        </button>
      </div>
    </dialog>
  )
}
