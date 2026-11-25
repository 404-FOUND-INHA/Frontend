import { ERROR_CODE, isApiError } from '@/api/ApiError'
import type { ScanRoomResponse, ScanSessionCreateRequest } from '@/types/scan/api'
import { isValidIsoDate } from '@/utils/calendarDate'

// 회차 생성 화면의 폼 검증·요청 변환·오류 문구(순수 함수). 화면 컴포넌트에서 분리해 단위 테스트한다.

export const MAX_SESSION_NAME_LENGTH = 100

/** 화면 입력 상태. API 요청 DTO(ScanSessionCreateRequest)와 구분한다. */
export interface CreateFormValues {
  name: string
  /** 선택한 자료실 zone. 선택 전에는 '' */
  zone: string
  /** 날짜 입력값 'YYYY-MM-DD'. 미입력이거나 브라우저가 잘못된 입력을 비워 둔 경우 '' */
  date: string
  /** 브라우저가 "입력은 했지만 올바른 날짜가 아님"으로 판단했는지(input.validity.badInput). 이때 value는 ''이다. */
  dateBadInput: boolean
}

export type NameError = 'blank' | 'tooLong'
export type ZoneError = 'unselected' | 'unavailable' | 'open'
export type DateError = 'invalid' | 'past'

export interface CreateFormErrors {
  name: NameError | null
  zone: ZoneError | null
  date: DateError | null
}

/** Backend·Mock은 공백을 제거하지 않고 원본을 저장한다. UI는 앞뒤 공백을 제거한 값을 보내고 길이도 그 값 기준으로 검사한다. */
export function trimmedName(name: string): string {
  return name.trim()
}

export function validateName(name: string): NameError | null {
  const trimmed = trimmedName(name)
  if (trimmed === '') return 'blank'
  return trimmed.length > MAX_SESSION_NAME_LENGTH ? 'tooLong' : null
}

export function validateZone(zone: string, rooms: readonly ScanRoomResponse[]): ZoneError | null {
  if (zone === '') return 'unselected'
  const room = rooms.find((item) => item.zone === zone)
  if (!room) return 'unavailable'
  return room.hasOpenSession ? 'open' : null
}

/**
 * 점검 예정일. today는 서울 기준 오늘('YYYY-MM-DD')이며 호출하는 쪽이 제출 시점마다 다시 계산해 넘긴다.
 * 'YYYY-MM-DD'는 문자열 비교가 날짜 비교와 같다. Date 객체의 날짜 보정에 의존하지 않는다.
 */
export function validateDate(date: string, badInput: boolean, today: string): DateError | null {
  if (badInput) return 'invalid'
  if (date === '') return null
  if (!isValidIsoDate(date)) return 'invalid'
  return date < today ? 'past' : null
}

export function validateCreateForm(
  values: CreateFormValues,
  rooms: readonly ScanRoomResponse[],
  today: string,
): CreateFormErrors & { valid: boolean } {
  const errors: CreateFormErrors = {
    name: validateName(values.name),
    zone: validateZone(values.zone, rooms),
    date: validateDate(values.date, values.dateBadInput, today),
  }
  return { ...errors, valid: errors.name === null && errors.zone === null && errors.date === null }
}

/** 화면 입력 → API 요청. 회차명은 앞뒤 공백을 제거하고, 예정일이 없으면 생략한다. */
export function toCreateRequest(values: CreateFormValues): ScanSessionCreateRequest {
  const request: ScanSessionCreateRequest = { sessionName: trimmedName(values.name), zone: values.zone }
  if (values.date !== '') request.plannedStartDate = values.date
  return request
}

export const NAME_ERROR_TEXT: Record<NameError, string> = {
  blank: '점검 회차명을 입력해 주세요',
  tooLong: `점검 회차명은 ${MAX_SESSION_NAME_LENGTH}자 이하로 입력해 주세요`,
}

export const DATE_ERROR_TEXT: Record<DateError, string> = {
  invalid: '올바른 날짜를 입력해 주세요',
  past: '오늘 이후 날짜를 선택해 주세요',
}

/** 자료실 표시 이름. "인문과학정보실 (3층)". 층 정보가 없으면 자료실명만 */
export function formatRoomName(room: Pick<ScanRoomResponse, 'zone' | 'floorNo'>): string {
  return room.floorNo === null ? room.zone : `${room.zone} (${room.floorNo}층)`
}

/** 선택 목록의 옵션 문구. 진행 중인 회차가 있는 자료실은 표시하되 안내를 붙인다. */
export function formatRoomOption(room: ScanRoomResponse): string {
  return room.hasOpenSession ? `${formatRoomName(room)} · 점검 진행 중` : formatRoomName(room)
}

/** useScanRooms(useQuery·QueryObserver) 결과 중 판정에 필요한 값만 */
export interface RoomsQueryLike {
  isPending: boolean
  isError: boolean
  isFetching: boolean
  isSuccess: boolean
  /** 지금까지 성공한 조회 횟수(TanStack Query 상태) */
  dataUpdateCount: number
  data: readonly ScanRoomResponse[] | undefined
}

/**
 * 409·SCAN_003으로 자료실 상태가 오래된 것이 확인된 뒤, 그 이후에 새로 성공한 조회가 아직 없으면 true.
 * conflictMark는 충돌을 확인한 시점의 dataUpdateCount다. 조회 성공 횟수가 그보다 늘어야(=충돌 이후 시작된 조회가 성공해야)
 * 해제되므로 충돌 이전의 캐시나 이전 성공 상태만으로는 풀리지 않고, 수동 재시도와 자동 재조회(재연결 등) 모두 같은 기준으로 해제된다.
 * 재조회가 실패하면 status가 error라 isSuccess가 false이므로 계속 true이다.
 */
export function isRoomsOutdated(conflictMark: number | null, q: Pick<RoomsQueryLike, 'isSuccess' | 'dataUpdateCount'>): boolean {
  return conflictMark !== null && !(q.isSuccess && q.dataUpdateCount > conflictMark)
}

export interface RoomsSnapshot {
  isPending: boolean
  isError: boolean
  isFetching: boolean
  roomCount: number
  selectableCount: number
  outdated: boolean
}

export function getRoomsSnapshot(q: RoomsQueryLike, conflictMark: number | null): RoomsSnapshot {
  const rooms = q.data ?? []
  return {
    isPending: q.isPending,
    isError: q.isError,
    isFetching: q.isFetching,
    roomCount: rooms.length,
    selectableCount: rooms.filter((room) => !room.hasOpenSession).length,
    outdated: isRoomsOutdated(conflictMark, q),
  }
}

export interface RoomsViewState {
  body: 'loading' | 'error' | 'empty' | 'list'
  /** 선택 가능한 자료실이 하나도 없음(목록은 표시) */
  noneSelectable: boolean
  /** 기존 목록은 표시하지만 마지막 재조회가 실패해 최신 상태를 알 수 없음. 오류 안내와 다시 시도를 보여준다. */
  refreshFailed: boolean
  /** 생성 요청에 사용할 수 있는 자료실 정보: 목록이 있고, 마지막 조회가 성공했고, 조회 중이 아니며, 오래된 상태가 아님 */
  usable: boolean
}

export function getRoomsViewState(s: RoomsSnapshot): RoomsViewState {
  // 오래된 상태에서 재조회까지 실패하면 이전 목록으로 선택·제출하지 못하게 오류로 보여준다.
  const body = s.isPending
    ? 'loading'
    : s.isError && (s.roomCount === 0 || s.outdated)
      ? 'error'
      : s.roomCount === 0
        ? 'empty'
        : 'list'
  return {
    body,
    noneSelectable: body === 'list' && s.selectableCount === 0,
    refreshFailed: body === 'list' && s.isError,
    usable: body === 'list' && !s.isError && !s.isFetching && !s.outdated,
  }
}

/** 생성 실패를 화면에 어떻게 보여줄지 */
export interface CreateFailure {
  /** 한 줄 안내. Backend 메시지 원문은 쓰지 않는다. */
  message: string
  /** 자료실 상태가 바뀌었을 수 있어 재조회와 선택 초기화가 필요한 실패 */
  refreshRooms: boolean
  /** 특정 입력 항목에 표시할 오류(Backend errors의 field로 확인된 경우만) */
  fields: { name?: string; zone?: string; date?: string }
}

export const FAILURE_GENERIC = '회차를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'

export function interpretCreateError(error: unknown): CreateFailure {
  if (!isApiError(error)) return { message: FAILURE_GENERIC, refreshRooms: false, fields: {} }

  if (error.status === 409 && error.code === ERROR_CODE.SCAN_SESSION_ALREADY_OPEN) {
    return { message: '이미 점검이 진행 중인 자료실입니다.', refreshRooms: true, fields: {} }
  }
  if (error.code === ERROR_CODE.SCAN_NO_ACTIVE_SHELF) {
    return { message: '점검할 수 있는 서가가 없는 자료실입니다.', refreshRooms: true, fields: {} }
  }
  if (error.code === ERROR_CODE.INVALID_INPUT) {
    // COMMON_001이 모두 예정일 오류는 아니다. errors의 field로 확인된 항목만 해당 입력에 표시한다.
    const fields: CreateFailure['fields'] = {}
    for (const { field } of error.errors) {
      if (field === 'sessionName') fields.name = '점검 회차명을 확인해 주세요'
      else if (field === 'zone') fields.zone = '자료실을 다시 선택해 주세요'
      else if (field === 'plannedStartDate') fields.date = '점검 예정일을 확인해 주세요'
    }
    return { message: '입력값을 확인해 주세요.', refreshRooms: false, fields }
  }
  return { message: FAILURE_GENERIC, refreshRooms: false, fields: {} }
}

export type RoomsRefreshPhase = 'none' | 'refreshing' | 'failed' | 'done'

/** 자료실 재조회가 끝나기 전에는 "새로 불러왔다"고 말하지 않는다. */
export function describeFailure(failure: CreateFailure, phase: RoomsRefreshPhase): string {
  if (!failure.refreshRooms || phase === 'none') return failure.message
  if (phase === 'refreshing') return `${failure.message} 자료실 상태를 다시 불러오는 중입니다.`
  if (phase === 'failed') return `${failure.message} 자료실 상태를 불러오지 못했습니다. 다시 시도해 주세요.`
  return `${failure.message} 자료실 상태를 새로 불러왔습니다. 다른 자료실을 선택해 주세요.`
}
