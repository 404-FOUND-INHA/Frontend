import { useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import Page from '@/components/common/Page'
import { CalendarIcon, ShelfIcon } from '@/components/common/icons'
import { scanKeys } from '@/hooks/scan/queryKeys'
import { useCreateScanSession } from '@/hooks/scan/useCreateScanSession'
import { useScanRooms } from '@/hooks/scan/useScanRooms'
import { seoulDate } from '@/utils/seoulTime'
import ScanRoomSelect from './ScanRoomSelect'
import {
  DATE_ERROR_TEXT,
  NAME_ERROR_TEXT,
  describeFailure,
  getRoomsSnapshot,
  getRoomsViewState,
  isRoomsOutdated,
  interpretCreateError,
  toCreateRequest,
  validateCreateForm,
  type CreateFailure,
  type RoomsRefreshPhase,
} from './scanCreateForm'
import { isFromList, scanPaths } from './scanPaths'
import './scanCreate.css'

// 장서점검 회차 생성. 성공하면 전체 목록(/scan)으로 replace 이동한다.
// 5단계에서 상세 화면이 생기면 성공 이동만 scanPaths.detail(created.id)로 바꾼다.
export default function ScanCreatePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const roomsQuery = useScanRooms()
  const create = useCreateScanSession()

  const [name, setName] = useState('')
  const [zone, setZone] = useState('')
  const [date, setDate] = useState('')
  const [dateBadInput, setDateBadInput] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [dateTouched, setDateTouched] = useState(false)
  // 서울 기준 오늘. 렌더 중에 시계를 읽지 않고, 입력·제출 시점마다 다시 계산해 자정 경계를 따라간다.
  const [today, setToday] = useState(() => seoulDate(Date.now()))
  const [failure, setFailure] = useState<CreateFailure | null>(null)
  // 409 등으로 자료실 상태가 오래된 것을 확인한 시점의 조회 성공 횟수(dataUpdateCount). 이후 새 조회가 성공하면(수동·자동 모두) 해제된다.
  const [conflictMark, setConflictMark] = useState<number | null>(null)
  const submittingRef = useRef(false) // 같은 틱의 연타를 막는다(isPending은 다음 렌더에 반영된다)
  const dateRef = useRef<HTMLInputElement>(null)

  const rooms = roomsQuery.data ?? []
  // 관측자 결과에는 성공 횟수가 없어 쿼리 상태(QueryState)에서 읽는다. 결과가 바뀔 때마다 다시 렌더링되므로 항상 최신이다.
  const roomsState = {
    isPending: roomsQuery.isPending,
    isError: roomsQuery.isError,
    isFetching: roomsQuery.isFetching,
    isSuccess: roomsQuery.isSuccess,
    data: roomsQuery.data,
    dataUpdateCount: queryClient.getQueryState(scanKeys.rooms())?.dataUpdateCount ?? 0,
  }
  const roomsOutdated = isRoomsOutdated(conflictMark, roomsState)
  const roomsView = getRoomsViewState(getRoomsSnapshot(roomsState, conflictMark))
  const roomsReady = roomsView.usable

  const values = { name, zone, date, dateBadInput }
  const check = validateCreateForm(values, rooms, today)
  const canSubmit = check.valid && roomsReady && !create.isPending

  const selectedRoom = rooms.find((room) => room.zone === zone)
  const nameCheckError = check.name === 'tooLong' || nameTouched ? check.name : null
  const nameError = nameCheckError ? NAME_ERROR_TEXT[nameCheckError] : failure?.fields.name
  const dateError = check.date && (dateTouched || date !== '') ? DATE_ERROR_TEXT[check.date] : failure?.fields.date

  const refreshRooms = () => void roomsQuery.refetch()

  const syncDate = (input: HTMLInputElement) => {
    setToday(seoulDate(Date.now()))
    setDate(input.value)
    setDateBadInput(input.validity.badInput)
  }

  const handleFailure = (error: unknown) => {
    const next = interpretCreateError(error)
    setFailure(next)
    if (next.refreshRooms) {
      // 자료실 상태가 바뀌었다: 선택을 비우고(회차명·예정일은 유지) 재조회가 성공할 때까지 제출을 막는다.
      setZone('')
      setConflictMark(queryClient.getQueryState(scanKeys.rooms())?.dataUpdateCount ?? 0)
      refreshRooms()
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (submittingRef.current || create.isPending) return
    setNameTouched(true)
    setDateTouched(true)
    // 제출 시점의 값으로 다시 검증한다(오늘 날짜 재계산, 날짜 입력의 badInput 재확인).
    const input = dateRef.current
    const nowDate = seoulDate(Date.now())
    setToday(nowDate)
    const submitted = { name, zone, date: input?.value ?? date, dateBadInput: input?.validity.badInput ?? false }
    if (!validateCreateForm(submitted, rooms, nowDate).valid || !roomsReady) {
      setDateBadInput(submitted.dateBadInput)
      return
    }
    submittingRef.current = true
    setFailure(null)
    create.mutate(toCreateRequest(submitted), {
      onSuccess: () => navigate(scanPaths.list, { replace: true }),
      onError: handleFailure,
      onSettled: () => {
        submittingRef.current = false
      },
    })
  }

  // 목록 FAB로 들어왔으면 이전 화면(목록, 필터 유지)으로, 아니면 /scan으로 안전하게 이동한다.
  const handleBack = () => {
    if (isFromList(location.state)) navigate(-1)
    else navigate(scanPaths.list, { replace: true })
  }

  const phase: RoomsRefreshPhase = !failure?.refreshRooms
    ? 'none'
    : !roomsOutdated
      ? 'done'
      : roomsQuery.isError && !roomsQuery.isFetching
        ? 'failed'
        : 'refreshing'
  const editing = () => setFailure(null)

  return (
    <Page
      title="점검 회차 생성"
      onBack={handleBack}
      footer={
        <>
          {failure && (
            <p className="scan-form-error" role="alert">
              {describeFailure(failure, phase)}
            </p>
          )}
          <button type="submit" form="scan-create-form" className="scan-cta" disabled={!canSubmit}>
            {create.isPending ? '생성 중…' : '점검 회차 생성'}
          </button>
        </>
      }
    >
      <form id="scan-create-form" className="scan-form" onSubmit={handleSubmit} noValidate>
        <div className="scan-field">
          <label htmlFor="scan-name" className="scan-label">
            점검 회차명 <span className="scan-req" aria-hidden="true">*</span>
          </label>
          <input
            id="scan-name"
            className={nameError ? 'scan-input scan-input--error' : 'scan-input'}
            type="text"
            aria-required="true"
            aria-describedby={nameError ? 'scan-name-error' : undefined}
            value={name}
            placeholder="예: 2026년 2학기 정기 장서점검"
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            onChange={(event) => {
              setName(event.target.value)
              editing()
            }}
            onBlur={() => setNameTouched(true)}
          />
          {nameError && <p id="scan-name-error" className="scan-field-note scan-field-note--error">{nameError}</p>}
        </div>

        <div className="scan-field">
          <label id="scan-zone-label" htmlFor="scan-zone" className="scan-label">
            점검 대상 자료실 <span className="scan-req" aria-hidden="true">*</span>
          </label>
          <ScanRoomSelect
            id="scan-zone"
            view={roomsView}
            rooms={rooms}
            value={zone}
            onChange={(next) => {
              setZone(next)
              editing()
            }}
            describedBy={failure?.fields.zone ? 'scan-zone-error' : undefined}
            fetching={roomsQuery.isFetching}
            onRetry={refreshRooms}
          />
          {failure?.fields.zone && (
            <p id="scan-zone-error" className="scan-field-note scan-field-note--error">
              {failure.fields.zone}
            </p>
          )}
        </div>

        {selectedRoom && !selectedRoom.hasOpenSession && (
          <div className="scan-infobox">
            <span className="scan-infobox-icon">
              <ShelfIcon size={20} />
            </span>
            <div>
              <p className="scan-infobox-title">점검 대상 서가</p>
              <p className="scan-infobox-text">
                선택한 자료실의 모든 서가({selectedRoom.shelfCount}개)가 포함됩니다.
              </p>
            </div>
          </div>
        )}

        <div className="scan-field">
          <label htmlFor="scan-date" className="scan-label">
            점검 예정일 <span className="scan-label-sub">(선택)</span>
          </label>
          <div className={date === '' && !dateBadInput ? 'scan-date scan-date--empty' : 'scan-date'}>
            <input
              ref={dateRef}
              id="scan-date"
              className={dateError ? 'scan-input scan-input--error' : 'scan-input'}
              type="date"
              min={today}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? 'scan-date-error' : undefined}
              onChange={(event) => {
                syncDate(event.currentTarget)
                editing()
              }}
              onBlur={(event) => {
                syncDate(event.currentTarget)
                setDateTouched(true)
              }}
            />
            <span className="scan-date-placeholder" aria-hidden="true">날짜 선택</span>
            <span className="scan-date-icon" aria-hidden="true">
              <CalendarIcon size={20} />
            </span>
          </div>
          {dateError && <p id="scan-date-error" className="scan-field-note scan-field-note--error">{dateError}</p>}
          {(date !== '' || dateBadInput) && (
            <button
              type="button"
              className="scan-date-clear"
              onClick={() => {
                if (dateRef.current) dateRef.current.value = ''
                setDate('')
                setDateBadInput(false)
                setDateTouched(false)
                editing()
              }}
            >
              날짜 지우기
            </button>
          )}
        </div>
      </form>
    </Page>
  )
}
