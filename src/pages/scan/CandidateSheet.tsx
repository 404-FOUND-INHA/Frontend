import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { SheetFooterState } from './scanResultsView'
import { handleDialogCancel, handleDialogClose } from './scanReviewView'
import './scanDetail.css'
import './scanResults.css'

interface CandidateSheetProps {
  title: string
  tone: 'missing' | 'disposal'
  /** 회차 전체의 후보 건수. 지금까지 불러온 목록의 길이가 아니다. */
  total: number
  /** 받아 둔 목록을 유지한 채 재조회에 실패했는가 */
  refreshError: boolean
  footer: SheetFooterState
  /** 조회 중: 더보기와 다시 시도를 막는다. */
  busy: boolean
  onLoadMore: () => void
  onRetry: () => void
  onClose: () => void
  /** 후보 항목(li) */
  children: ReactNode
}

/**
 * 후보 목록 하단 시트. 열려 있는 동안만 렌더링한다. 브라우저 기본 dialog가 포커스 가두기와 Esc를 맡는다.
 * 헤더는 고정하고 목록만 스크롤한다.
 */
export default function CandidateSheet({
  title,
  tone,
  total,
  refreshError,
  footer,
  busy,
  onLoadMore,
  onRetry,
  onClose,
  children,
}: CandidateSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 시트 안에서 누른 채 바깥에서 떼는 동작(글자 선택 등)은 배경 누르기가 아니다.
  const pressedBackdrop = useRef(false)
  const titleId = useId()

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    // 화면에서 제거하기 전에 닫아야 포커스가 시트를 열었던 위치로 돌아간다.
    return () => dialog.close()
  }, [])

  // 포커스가 있는 더보기·다시 시도 버튼은 조회가 시작되면 비활성화되고, 끝나면 사라질 수 있다. 그대로 두면 포커스가
  // body로 빠져 키보드로 목록을 넘길 수 없으므로, 브라우저가 포커스를 거두기 전(렌더 직후)에 목록으로 옮긴다.
  // 버튼에 포커스가 없으면(다른 곳으로 옮겼거나, 눌러도 포커스를 주지 않는 브라우저) 아무것도 하지 않는다.
  useLayoutEffect(() => {
    const list = listRef.current
    const focused = document.activeElement
    if (list && focused?.matches(':disabled') && list.contains(focused)) list.focus({ preventScroll: true })
  })

  return (
    // 내용(.scan-sheet-panel)이 dialog를 빈틈없이 채우므로, dialog 자체가 대상인 클릭은 배경 누르기다.
    <dialog
      ref={ref}
      className={`scan-sheet scan-sheet--${tone}`}
      aria-labelledby={titleId}
      onCancel={(event) => handleDialogCancel(event, false, onClose)}
      onClose={(event) => handleDialogClose(event.currentTarget, false, onClose)}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedBackdrop.current) onClose()
      }}
    >
      <div className="scan-sheet-panel">
        <span className="scan-sheet-handle" aria-hidden="true" />
        <header className="scan-sheet-header">
          <h2 id={titleId} className="scan-sheet-title">
            {title}
          </h2>
          <span className="scan-sheet-total">총 {total}권</span>
          <button type="button" className="scan-sheet-close" aria-label="닫기" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {/* Tab으로도 올 수 있어야 누를 것이 없는 목록을 키보드로 다시 넘길 수 있다. (tabIndex -1은 Tab 순서에서 빠진다) */}
        <div ref={listRef} className="scan-sheet-body" tabIndex={0} role="group" aria-label={`${title} 목록`}>
          {refreshError && (
            <div className="scan-detail-notice" role="alert">
              <span>목록을 새로 불러오지 못했습니다.</span>
              <button type="button" className="scan-detail-btn" disabled={busy} onClick={onRetry}>
                {busy ? '불러오는 중…' : '다시 시도'}
              </button>
            </div>
          )}

          {total === 0 ? <p className="scan-sheet-empty">표시할 후보가 없습니다.</p> : <ul className="scan-sheet-list">{children}</ul>}

          {footer.nextPageError && (
            <div className="scan-detail-notice scan-sheet-next-error" role="alert">
              <span>다음 목록을 불러오지 못했습니다.</span>
              <button type="button" className="scan-detail-btn" disabled={busy} onClick={onLoadMore}>
                {busy ? '불러오는 중…' : '다시 시도'}
              </button>
            </div>
          )}
          {footer.showMore && (
            <button type="button" className="scan-sheet-more" disabled={busy} onClick={onLoadMore}>
              {footer.moreLoading ? '불러오는 중…' : '더보기'}
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}
