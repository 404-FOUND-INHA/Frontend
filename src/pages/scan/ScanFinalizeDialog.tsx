import { useId, useLayoutEffect, useRef } from 'react'
import type { ReviewSummary } from '@/types/scan/review'
import { handleDialogCancel, handleDialogClose } from './scanReviewView'
import './scanReview.css'

interface ScanFinalizeDialogProps {
  sessionName: string
  /** 검토 현황을 알 수 없으면 null */
  summary: ReviewSummary | null
  guide: string
  /** 확정 요청 진행 중: 닫기와 버튼을 모두 막는다. */
  pending: boolean
  canConfirm: boolean
  errorText: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** 회차 확정 확인 모달. 열려 있는 동안만 렌더링한다. 브라우저 기본 dialog가 포커스 가두기를 맡는다. */
export default function ScanFinalizeDialog({
  sessionName,
  summary,
  guide,
  pending,
  canConfirm,
  errorText,
  onCancel,
  onConfirm,
}: ScanFinalizeDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    // 화면에서 제거하기 전에 닫아야 포커스가 모달을 열었던 위치로 돌아간다.
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={ref}
      className="scan-dialog"
      aria-labelledby={titleId}
      aria-busy={pending}
      onCancel={(event) => handleDialogCancel(event, pending, onCancel)}
      onClose={(event) => handleDialogClose(event.currentTarget, pending, onCancel)}
    >
      <h2 id={titleId} className="scan-dialog-title">
        점검 회차 확정
      </h2>
      <p className="scan-dialog-session">{sessionName}</p>
      <p className="scan-dialog-guide">{guide}</p>
      <p className="scan-dialog-question">이 회차의 장서점검 결과를 최종 확정하시겠습니까?</p>

      {summary && (
        <dl className="scan-dialog-summary">
          <div>
            <dt>이상 도서 검토</dt>
            <dd>{summary.totalRequired === 0 ? '대상 없음' : `${summary.reviewed} / ${summary.totalRequired}건 완료`}</dd>
          </div>
          <div>
            <dt>미처리 건수</dt>
            <dd className="scan-dialog-remaining">{summary.remaining}건</dd>
          </div>
        </dl>
      )}

      <p className="scan-dialog-note">확정한 뒤에는 검토 결과를 변경할 수 없습니다.</p>

      {errorText && !pending && (
        <p className="scan-dialog-error" role="alert">
          {errorText}
        </p>
      )}

      <div className="scan-dialog-actions">
        <button type="button" className="scan-dialog-btn scan-dialog-btn--cancel" disabled={pending} onClick={onCancel}>
          취소
        </button>
        <button type="button" className="scan-dialog-btn scan-dialog-btn--confirm" disabled={!canConfirm} onClick={onConfirm}>
          {pending ? '확정 중…' : '확정'}
        </button>
      </div>
    </dialog>
  )
}
