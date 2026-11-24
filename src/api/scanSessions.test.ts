import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findInvariantViolations } from '@/mocks/scan/invariants'
import { SEED_ZONES } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import { ApiError, ERROR_CODE } from './ApiError'
import { createScanSession, getScanRooms, getScanSession, getScanSessions } from './scanSessions'

const NOW = Date.parse('2026-11-24T03:00:00Z')

beforeEach(() => {
  resetScanStore({ now: () => NOW })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('ApiError로 거부되어야 합니다')
}

describe('데이터 접근 함수', () => {
  it('응답 봉투 없이 data에 해당하는 값만 돌려준다', async () => {
    expect(Array.isArray(await getScanRooms())).toBe(true)

    const page = await getScanSessions({ status: ['REVIEW'] })
    expect(Object.keys(page).sort()).toEqual(['content', 'page', 'size', 'totalElements', 'totalPages'])

    const session = await getScanSession(page.content[0].id)
    expect(session).toEqual(page.content[0])
  })

  it('생성하면 이후 목록·상세·자료실 조회에 같은 데이터로 반영된다', async () => {
    const created = await createScanSession({ sessionName: '접근 계층 테스트', zone: SEED_ZONES.MULTIMEDIA })

    expect((await getScanSessions()).content[0]).toEqual(created)
    expect(await getScanSession(created.id)).toEqual(created)
    const room = (await getScanRooms()).find((r) => r.zone === SEED_ZONES.MULTIMEDIA)
    expect(room?.hasOpenSession).toBe(true)
  })

  it('실패는 상태 코드와 Backend 에러 코드를 가진 ApiError로 거부된다', async () => {
    const conflict = await rejection(createScanSession({ sessionName: '중복', zone: SEED_ZONES.HUMANITIES }))
    expect(conflict).toMatchObject({ status: 409, code: ERROR_CODE.SCAN_SESSION_ALREADY_OPEN, errors: [] })

    const notFound = await rejection(getScanSession(99_999))
    expect(notFound).toMatchObject({ status: 404, code: ERROR_CODE.SCAN_SESSION_NOT_FOUND })

    const invalid = await rejection(createScanSession({ sessionName: '', zone: SEED_ZONES.REFERENCE }))
    expect(invalid).toMatchObject({ status: 400, code: ERROR_CODE.INVALID_INPUT })
    expect(invalid.errors.map((e) => e.field)).toEqual(['sessionName'])
  })
})

describe('같은 자료실에 대한 동시 생성', () => {
  const request = { sessionName: '동시 생성', zone: SEED_ZONES.REFERENCE }

  function expectOnlyOneCreated(results: PromiseSettledResult<unknown>[], attempts: number) {
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(attempts - 1)
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(ApiError)
      expect(result.reason).toMatchObject({ status: 409, code: ERROR_CODE.SCAN_SESSION_ALREADY_OPEN })
    }

    const data = getScanStore().snapshot()
    const created = data.sessions.filter((s) => s.zone === request.zone && s.status === 'IN_PROGRESS')
    expect(created).toHaveLength(1) // 회차는 하나만 추가
    expect(data.sessions).toHaveLength(32)

    // 대상 서가 관계가 중복 없이 한 번씩만 등록
    const links = data.sessionShelves.filter((l) => l.sessionId === created[0].id)
    expect(links.map((l) => l.shelfId)).toEqual([15, 16])
    expect(findInvariantViolations(data)).toEqual([])

    // hasOpenSession과 실제 회차 상태 일치 (지연 타이머가 켜진 테스트에서도 멈추지 않도록 저장소를 직접 읽는다)
    const rooms = getScanStore().getRooms()
    for (const room of rooms) {
      expect(room.hasOpenSession).toBe(data.sessions.some((s) => s.zone === room.zone && s.status !== 'COMPLETED'))
    }
    expect(rooms.find((r) => r.zone === request.zone)?.hasOpenSession).toBe(true)
    expect(getScanStore().getSessions({ size: 100 }).totalElements).toBe(32)
  }

  it('동시에 여러 번 요청해도 한 요청만 성공하고 나머지는 409 SCAN_002이다', async () => {
    const attempts = 5
    const results = await Promise.allSettled(Array.from({ length: attempts }, () => createScanSession(request)))
    expectOnlyOneCreated(results, attempts)
  })

  it('응답이 지연되는 비동기 경로에서도 검사와 저장 사이에 다른 요청이 끼어들지 못한다', async () => {
    vi.stubEnv('MODE', 'development') // 테스트용 무지연 모드를 끄고 실제 지연(타이머)을 사용
    vi.useFakeTimers()
    const attempts = 5

    const pending = Promise.allSettled(Array.from({ length: attempts }, () => createScanSession(request)))
    expect(getScanStore().snapshot().sessions).toHaveLength(31) // 지연 중에는 아직 아무것도 저장되지 않음

    await vi.advanceTimersByTimeAsync(300)
    expectOnlyOneCreated(await pending, attempts)
  })

  it('서로 다른 자료실에 대한 동시 생성은 모두 성공하고 ID가 겹치지 않는다', async () => {
    const [a, b] = await Promise.all([
      createScanSession({ sessionName: 'a', zone: SEED_ZONES.REFERENCE }),
      createScanSession({ sessionName: 'b', zone: SEED_ZONES.MULTIMEDIA }),
    ])
    expect(a.id).not.toBe(b.id)
    expect(findInvariantViolations(getScanStore().snapshot())).toEqual([])
  })
})
