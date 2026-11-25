import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon } from '@/components/common/icons'
import type { ScanRoomResponse } from '@/types/scan/api'
import { formatRoomName, type RoomsViewState } from './scanCreateForm'
import { firstEnabledIndex, lastEnabledIndex, nextEnabledIndex, resolveActiveIndex } from './roomNav'

interface ScanRoomSelectProps {
  /** 선택 바(버튼)의 id. 라벨의 htmlFor가 가리킨다. */
  id: string
  view: RoomsViewState
  rooms: readonly ScanRoomResponse[]
  value: string
  /** 선택 오류 문구 등 외부 안내의 id */
  describedBy?: string
  onChange: (zone: string) => void
  /** 자료실 재조회 중(재시도 버튼 중복 클릭 방지) */
  fetching: boolean
  onRetry: () => void
}

/**
 * 자료실 선택(커스텀 드롭다운). 점검 진행 중인 자료실도 목록에 표시하되 선택할 수 없다.
 * 값(zone)과 onChange 계약은 네이티브 select일 때와 같다. 판정은 모두 부모가 넘기는 view를 따른다.
 */
export default function ScanRoomSelect({ id, view, rooms, value, onChange, describedBy, fetching, onRetry }: ScanRoomSelectProps) {
  const enabled = view.body === 'list'
  const [open, setOpen] = useState(false)
  const [activeRaw, setActiveRaw] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLButtonElement>(null)

  // 자료실 영역이 비활성이 되면(조회 오류 등) 열린 패널도 닫는다. (렌더 중 상태 조정)
  if (open && !enabled) setOpen(false)
  const isOpen = open && enabled
  // 목록이 바뀌어 활성 항목이 사라지거나 선택할 수 없게 되어도 항상 실제 항목을 가리킨다.
  const active = isOpen ? resolveActiveIndex(rooms, activeRaw, value) : -1

  const listId = `${id}-list`
  const optionId = (index: number) => `${id}-option-${index}`
  const errorNoteId = `${id}-error-note`
  const emptyNoteId = `${id}-empty-note`
  const noneNoteId = `${id}-none-note`

  const selectedRoom = rooms.find((room) => room.zone === value)
  const showError = view.body === 'error' || view.refreshFailed
  const showEmpty = view.body === 'empty'
  const showNone = view.noneSelectable
  const described =
    [showError ? errorNoteId : null, showEmpty ? emptyNoteId : null, showNone ? noneNoteId : null, describedBy]
      .filter(Boolean)
      .join(' ') || undefined

  const barText =
    enabled && selectedRoom
      ? formatRoomName(selectedRoom)
      : view.body === 'loading'
        ? '자료실을 불러오는 중…'
        : view.body === 'error'
          ? '자료실을 불러오지 못했습니다'
          : '자료실을 선택해 주세요'

  const openPanel = (fromEnd = false) => {
    const selectedIndex = rooms.findIndex((room) => room.zone === value && !room.hasOpenSession)
    setActiveRaw(selectedIndex >= 0 ? selectedIndex : fromEnd ? lastEnabledIndex(rooms) : firstEnabledIndex(rooms))
    setOpen(true)
  }

  const choose = (index: number) => {
    const room = rooms[index]
    if (!room || room.hasOpenSession) return // 점검 진행 중인 자료실은 선택할 수 없다.
    onChange(room.zone)
    setOpen(false)
    barRef.current?.focus()
  }

  // 바깥 영역을 누르면 닫는다. 열려 있는 동안에만 등록한다.
  useEffect(() => {
    if (!isOpen) return
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [isOpen])

  // 키보드로 활성 항목이 바뀌면 보이는 위치로 스크롤한다(패널 내부, 필요하면 본문도 최소한만).
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, id])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!enabled) return
    switch (event.key) {
      case 'Enter':
      case ' ':
        // 폼 제출이나 버튼의 기본 클릭(Space는 keyup)이 일어나지 않게 직접 처리한다.
        event.preventDefault()
        // 키를 계속 누르면 keydown이 반복된다. 반복 이벤트로 열림·선택이 연달아 일어나지 않게 첫 입력만 처리한다.
        if (event.repeat) break
        if (isOpen) choose(active)
        else openPanel()
        break
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        if (!isOpen) openPanel(event.key === 'ArrowUp')
        else setActiveRaw(nextEnabledIndex(rooms, active, event.key === 'ArrowDown' ? 1 : -1))
        break
      }
      case 'Home':
      case 'End':
        if (isOpen) {
          event.preventDefault()
          setActiveRaw(event.key === 'Home' ? firstEnabledIndex(rooms) : lastEnabledIndex(rooms))
        }
        break
      case 'Escape':
        if (isOpen) {
          event.preventDefault()
          setOpen(false)
        }
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <>
      <div className="scan-dropdown" ref={wrapRef}>
        <button
          ref={barRef}
          id={id}
          type="button"
          className={isOpen ? 'scan-dropdown-bar scan-dropdown-bar--open' : 'scan-dropdown-bar'}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-activedescendant={isOpen && active >= 0 ? optionId(active) : undefined}
          aria-required="true"
          aria-describedby={described}
          disabled={!enabled}
          onClick={() => (isOpen ? setOpen(false) : openPanel())}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => {
            if (event.key === ' ') event.preventDefault() // Space의 keyup 클릭으로 다시 열리는 것을 막는다.
          }}
        >
          <span className={enabled && selectedRoom ? 'scan-dropdown-value' : 'scan-dropdown-value scan-dropdown-value--placeholder'}>
            {barText}
          </span>
          <span className="scan-dropdown-chevron">
            <ChevronDownIcon size={18} />
          </span>
        </button>

        {isOpen && (
          <ul id={listId} className="scan-dropdown-panel" role="listbox" aria-labelledby={`${id}-label`} tabIndex={-1}>
            {rooms.map((room, index) => {
              const selected = room.zone === value
              const className = [
                'scan-dropdown-item',
                selected && !room.hasOpenSession ? 'scan-dropdown-item--selected' : '',
                room.hasOpenSession ? 'scan-dropdown-item--disabled' : '',
                index === active ? 'scan-dropdown-item--active' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <li
                  key={room.zone}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={room.hasOpenSession || undefined}
                  className={className}
                  onMouseDown={(event) => event.preventDefault()} // 바의 포커스를 유지한다.
                  onMouseEnter={() => !room.hasOpenSession && setActiveRaw(index)}
                  onClick={() => choose(index)}
                >
                  <span className="scan-dropdown-name">{formatRoomName(room)}</span>
                  {room.hasOpenSession ? (
                    <span className="scan-dropdown-badge">점검 진행 중</span>
                  ) : (
                    selected && (
                      <span className="scan-dropdown-check">
                        <CheckIcon size={18} />
                      </span>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {showError && (
        <div id={errorNoteId} className="scan-field-note scan-field-note--error" role="alert">
          <span>
            {view.refreshFailed ? '자료실 상태를 새로 불러오지 못했습니다' : '자료실 목록을 불러오지 못했습니다'}
          </span>
          <button type="button" className="scan-retry" disabled={fetching} onClick={onRetry}>
            {fetching ? '불러오는 중…' : '다시 시도'}
          </button>
        </div>
      )}
      {showEmpty && (
        <p id={emptyNoteId} className="scan-field-note">
          점검할 수 있는 자료실이 없습니다
        </p>
      )}
      {showNone && (
        <p id={noneNoteId} className="scan-field-note">
          점검 가능한 자료실이 없습니다. 진행 중인 회차가 끝나면 선택할 수 있습니다.
        </p>
      )}
    </>
  )
}
