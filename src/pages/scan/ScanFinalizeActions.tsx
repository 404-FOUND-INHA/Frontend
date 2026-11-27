import { useRef, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { scanKeys } from '@/hooks/scan/queryKeys'
import { useFinalizeScanSession } from '@/hooks/scan/useFinalizeScanSession'
import type { ScanSessionResponse } from '@/types/scan/api'
import ScanFinalizeDialog from './ScanFinalizeDialog'
import {
  FINALIZE_ERROR_TEXT,
  describeFinalizeError,
  getFinalizeState,
  requestFinalize,
  type ReviewViewState,
} from './scanReviewView'
import './scanReview.css'

interface ScanFinalizeActionsProps {
  session: Pick<ScanSessionResponse, 'id' | 'sessionName' | 'status'>
  review: ReviewViewState
}

/**
 * 회차 확정 버튼, 안내, 확인 모달. REVIEW 회차에서만 렌더링한다.
 * 확정에 성공하면 회차 상세 캐시가 COMPLETED가 되어 이 영역 전체가 사라진다.
 */
export default function ScanFinalizeActions({ session, review }: ScanFinalizeActionsProps) {
  const finalize = useFinalizeScanSession(session.id)
  // 화면을 벗어났다가 돌아와도 진행 중인 요청을 알 수 있도록 회차별 mutation을 함께 확인한다.
  const running = useIsMutating({ mutationKey: scanKeys.finalize(session.id), exact: true })
  const [open, setOpen] = useState(false)
  const [offline, setOffline] = useState(false) // 마지막 제출을 연결이 없어 보내지 않았는가
  const lock = useRef(false)

  const submitting = finalize.isPending || running > 0
  const state = getFinalizeState({ status: session.status, review, submitting })

  const openDialog = () => {
    finalize.reset() // 이전 시도의 오류를 지우고 연다.
    setOffline(false)
    setOpen(true)
  }

  return (
    <div className="scan-finalize">
      <button type="button" className="scan-finalize-btn" disabled={!state.enabled} onClick={openDialog}>
        {submitting ? '확정 중…' : '점검 회차 확정'}
      </button>
      <p className="scan-finalize-guide">{state.guide}</p>

      {open && (
        <ScanFinalizeDialog
          sessionName={session.sessionName}
          summary={review.body === 'result' ? review.summary : null}
          guide={state.guide}
          pending={submitting}
          canConfirm={state.enabled}
          errorText={
            offline ? FINALIZE_ERROR_TEXT.offline : finalize.isError ? describeFinalizeError(finalize.error) : null
          }
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOffline(false)
            requestFinalize(
              lock,
              state.enabled,
              (options) => finalize.mutate(undefined, { ...options, onSuccess: () => setOpen(false) }),
              () => setOffline(true),
            )
          }}
        />
      )}
    </div>
  )
}
