import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/ApiError'
import type { ScanRoomResponse } from '@/types/scan/api'
import {
  FAILURE_GENERIC,
  describeFailure,
  formatRoomName,
  formatRoomOption,
  getRoomsViewState,
  interpretCreateError,
  toCreateRequest,
  validateCreateForm,
  validateDate,
  validateName,
  validateZone,
  type CreateFormValues,
  type RoomsSnapshot,
} from './scanCreateForm'
import { FROM_LIST_STATE, isFromList } from './scanPaths'

const rooms: ScanRoomResponse[] = [
  { zone: '참고열람실', floorNo: 2, shelfCount: 2, hasOpenSession: false },
  { zone: '인문과학정보실', floorNo: 3, shelfCount: 3, hasOpenSession: true },
  { zone: '멀티미디어실', floorNo: null, shelfCount: 1, hasOpenSession: false },
]
const TODAY = '2026-11-24'

describe('validateName', () => {
  it('빈 값과 공백만 입력은 거부', () => {
    expect(validateName('')).toBe('blank')
    expect(validateName('   \t ')).toBe('blank')
  })
  it('앞뒤 공백을 제거한 길이로 100자를 판단', () => {
    expect(validateName('가'.repeat(100))).toBeNull()
    expect(validateName('가'.repeat(101))).toBe('tooLong')
    expect(validateName(`  ${'가'.repeat(100)}  `)).toBeNull() // trim 후 100자
    expect(validateName(` ${'가'.repeat(101)} `)).toBe('tooLong')
  })
})

describe('validateZone', () => {
  it('미선택, 목록에 없음, 점검 진행 중, 선택 가능', () => {
    expect(validateZone('', rooms)).toBe('unselected')
    expect(validateZone('없는실', rooms)).toBe('unavailable')
    expect(validateZone('인문과학정보실', rooms)).toBe('open')
    expect(validateZone('참고열람실', rooms)).toBeNull()
  })
})

describe('validateDate', () => {
  it('미입력은 허용', () => expect(validateDate('', false, TODAY)).toBeNull())
  it('오늘과 미래는 허용, 과거는 거부', () => {
    expect(validateDate('2026-11-24', false, TODAY)).toBeNull()
    expect(validateDate('2026-11-25', false, TODAY)).toBeNull()
    expect(validateDate('2027-01-01', false, TODAY)).toBeNull()
    expect(validateDate('2026-11-23', false, TODAY)).toBe('past')
  })
  it('브라우저가 잘못된 입력(badInput)으로 판단하면 value가 비어 있어도 거부', () => {
    expect(validateDate('', true, TODAY)).toBe('invalid')
  })
  it('존재하지 않는 날짜와 윤년', () => {
    expect(validateDate('2026-02-30', false, TODAY)).toBe('invalid')
    expect(validateDate('2028-02-29', false, TODAY)).toBeNull()
    expect(validateDate('2027-02-29', false, TODAY)).toBe('invalid')
    expect(validateDate('abc', false, TODAY)).toBe('invalid')
  })
  it('today는 호출하는 쪽이 정한 서울 기준 날짜를 그대로 쓴다(자정 경계)', () => {
    expect(validateDate('2026-11-24', false, '2026-11-25')).toBe('past')
  })
})

describe('validateCreateForm', () => {
  const ok: CreateFormValues = { name: '2026년 2학기 점검', zone: '참고열람실', date: '', dateBadInput: false }
  it('필수값이 모두 유효하면 제출 가능', () => expect(validateCreateForm(ok, rooms, TODAY).valid).toBe(true))
  it('회차명 없음 / 자료실 미선택 / 진행 중 자료실 / 잘못된 날짜는 제출 불가', () => {
    expect(validateCreateForm({ ...ok, name: ' ' }, rooms, TODAY).valid).toBe(false)
    expect(validateCreateForm({ ...ok, zone: '' }, rooms, TODAY).valid).toBe(false)
    expect(validateCreateForm({ ...ok, zone: '인문과학정보실' }, rooms, TODAY).valid).toBe(false)
    expect(validateCreateForm({ ...ok, date: '2026-01-01' }, rooms, TODAY).valid).toBe(false)
    expect(validateCreateForm({ ...ok, dateBadInput: true }, rooms, TODAY).valid).toBe(false)
  })
  it('예정일이 유효하면 제출 가능', () => {
    expect(validateCreateForm({ ...ok, date: TODAY }, rooms, TODAY).valid).toBe(true)
  })
})

describe('toCreateRequest', () => {
  it('회차명을 trim하고 예정일이 없으면 생략', () => {
    expect(toCreateRequest({ name: '  점검  ', zone: '참고열람실', date: '', dateBadInput: false })).toEqual({
      sessionName: '점검',
      zone: '참고열람실',
    })
  })
  it('예정일이 있으면 포함', () => {
    expect(toCreateRequest({ name: 'a', zone: 'z', date: '2026-12-01', dateBadInput: false }).plannedStartDate).toBe('2026-12-01')
  })
})

describe('자료실 표시', () => {
  it('층이 있으면 함께, 없으면 자료실명만', () => {
    expect(formatRoomName(rooms[0])).toBe('참고열람실 (2층)')
    expect(formatRoomName(rooms[2])).toBe('멀티미디어실')
  })
  it('점검 진행 중 자료실은 안내를 붙인다', () => {
    expect(formatRoomOption(rooms[1])).toBe('인문과학정보실 (3층) · 점검 진행 중')
    expect(formatRoomOption(rooms[0])).toBe('참고열람실 (2층)')
  })
})

describe('getRoomsViewState', () => {
  const base: RoomsSnapshot = { isPending: false, isError: false, isFetching: false, roomCount: 3, selectableCount: 2, outdated: false }
  it('조회 중 / 최초 실패 / 0건 / 목록', () => {
    expect(getRoomsViewState({ ...base, isPending: true, roomCount: 0 }).body).toBe('loading')
    expect(getRoomsViewState({ ...base, isError: true, roomCount: 0 }).body).toBe('error')
    expect(getRoomsViewState({ ...base, roomCount: 0, selectableCount: 0 }).body).toBe('empty')
    expect(getRoomsViewState(base).body).toBe('list')
  })
  it('선택 가능한 자료실이 없으면 목록은 표시하고 안내', () => {
    expect(getRoomsViewState({ ...base, selectableCount: 0 })).toMatchObject({ body: 'list', noneSelectable: true })
  })
  it('백그라운드 재조회 실패는 목록 유지, 오래된 상태의 재조회 실패는 오류', () => {
    expect(getRoomsViewState({ ...base, isError: true }).body).toBe('list')
    expect(getRoomsViewState({ ...base, isError: true, outdated: true }).body).toBe('error')
  })
})

describe('interpretCreateError', () => {
  const api = (status: number, code: string, errors: { field: string; reason: string }[] = []) =>
    new ApiError(status, { code, message: 'x', errors })
  it('409 SCAN_002: 자료실 재조회 필요', () => {
    expect(interpretCreateError(api(409, 'SCAN_002'))).toMatchObject({ refreshRooms: true, message: '이미 점검이 진행 중인 자료실입니다.' })
  })
  it('400 SCAN_003: 자료실 재조회 필요', () => {
    expect(interpretCreateError(api(400, 'SCAN_003')).refreshRooms).toBe(true)
  })
  it('COMMON_001: errors의 field로 확인된 입력에만 표시', () => {
    const f = interpretCreateError(api(400, 'COMMON_001', [{ field: 'sessionName', reason: 'r' }]))
    expect(f.fields.name).toBeDefined()
    expect(f.fields.date).toBeUndefined()
    expect(f.refreshRooms).toBe(false)
    expect(interpretCreateError(api(400, 'COMMON_001', [{ field: 'plannedStartDate', reason: 'r' }])).fields.date).toBeDefined()
  })
  it('COMMON_001에 필드 정보가 없으면 날짜로 단정하지 않고 일반 안내', () => {
    const f = interpretCreateError(api(400, 'COMMON_001'))
    expect(f.fields).toEqual({})
    expect(f.message).toBe('입력값을 확인해 주세요.')
  })
  it('기타 오류와 ApiError가 아닌 오류는 일반 실패 문구', () => {
    expect(interpretCreateError(api(500, 'COMMON_999')).message).toBe(FAILURE_GENERIC)
    expect(interpretCreateError(new Error('network')).message).toBe(FAILURE_GENERIC)
  })
})

describe('describeFailure', () => {
  const conflict = interpretCreateError(new ApiError(409, { code: 'SCAN_002', message: 'x', errors: [] }))
  it('재조회가 끝나기 전에는 "새로 불러왔다"고 말하지 않는다', () => {
    expect(describeFailure(conflict, 'refreshing')).toContain('다시 불러오는 중')
    expect(describeFailure(conflict, 'refreshing')).not.toContain('새로 불러왔습니다')
    expect(describeFailure(conflict, 'failed')).toContain('불러오지 못했습니다')
  })
  it('재조회 성공 후에만 새로 불러왔다고 안내', () => {
    expect(describeFailure(conflict, 'done')).toContain('새로 불러왔습니다')
  })
  it('재조회가 필요 없는 실패는 문구 그대로', () => {
    const generic = interpretCreateError(new Error('x'))
    expect(describeFailure(generic, 'done')).toBe(FAILURE_GENERIC)
  })
})

describe('isFromList', () => {
  it('FAB가 넘기는 state만 목록 진입으로 인정', () => {
    expect(isFromList(FROM_LIST_STATE)).toBe(true)
    expect(isFromList(null)).toBe(false)
    expect(isFromList(undefined)).toBe(false)
    expect(isFromList({ fromList: 'yes' })).toBe(false)
    expect(isFromList('x')).toBe(false)
  })
})
