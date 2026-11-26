import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { ScanSessionStatus } from '@/types/scan/api'
import { findInvariantViolations } from './invariants'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from './seed'
import { createScanStore } from './store'
import type { MockData } from './types'

const NOW = Date.parse('2026-11-24T03:00:00Z') // 서울 2026-11-24 12:00:00

function newStore(now = NOW) {
  return createScanStore(createSeedData(), { now: () => now })
}

function apiError(run: () => unknown): ApiError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('ApiError가 발생해야 합니다')
}

function expectRejected(run: () => unknown, status: number, code: string): ApiError {
  const error = apiError(run)
  expect({ status: error.status, code: error.code }).toEqual({ status, code })
  return error
}

/** 서가 구성을 직접 지정하는 작은 데이터 */
function customData(overrides: Partial<MockData> = {}): MockData {
  return {
    shelves: [
      { id: 1, shelfCode: 'X-01', zone: 'X', floorNo: 3, widthCm: 90, displayOrder: 1, active: true },
      { id: 2, shelfCode: 'X-02', zone: 'X', floorNo: 1, widthCm: 90, displayOrder: 2, active: true },
      { id: 3, shelfCode: 'X-03', zone: 'X', floorNo: 0, widthCm: 90, displayOrder: 3, active: false }, // 비활성은 층 계산·등록에서 제외
      { id: 4, shelfCode: 'N-01', zone: 'NOFLOOR', floorNo: null, widthCm: null, displayOrder: 1, active: true },
      { id: 5, shelfCode: 'OFF-01', zone: 'OFF', floorNo: 2, widthCm: 90, displayOrder: 1, active: false },
      { id: 6, shelfCode: 'B-01', zone: '   ', floorNo: 2, widthCm: 90, displayOrder: 1, active: true }, // 공백 zone은 자료실이 아님
      { id: 7, shelfCode: 'U-01', zone: null, floorNo: 2, widthCm: 90, displayOrder: 1, active: true }, // zone 없음
    ],
    sessions: [],
    sessionShelves: [],
    books: [],
    observations: [],
    ...overrides,
  }
}

describe('회차 생성', () => {
  it('정상 생성하면 IN_PROGRESS / VISION_WAITING 상태로 시작하고 시각이 설정된다', () => {
    const store = newStore()
    const maxId = Math.max(...store.snapshot().sessions.map((s) => s.id))

    const created = store.createSession({ sessionName: '2026년 2학기 참고열람실 점검', zone: SEED_ZONES.REFERENCE })

    expect(created).toEqual({
      id: maxId + 1,
      sessionName: '2026년 2학기 참고열람실 점검',
      status: 'IN_PROGRESS',
      processingStage: 'VISION_WAITING',
      zone: SEED_ZONES.REFERENCE,
      floorNo: 2,
      plannedStartDate: null,
      startedAt: '2026-11-24T12:00:00',
      finalizedAt: null,
      createdAt: '2026-11-24T12:00:00',
    })
  })

  it('회차명은 앞뒤 공백을 포함해 입력한 그대로 저장한다 (Backend는 trim하지 않는다)', () => {
    const store = newStore()
    const created = store.createSession({ sessionName: ' 점검 ', zone: SEED_ZONES.REFERENCE })
    expect(created.sessionName).toBe(' 점검 ')
  })

  it('해당 자료실의 활성 서가만 WAITING 상태의 대상 서가로 함께 등록한다', () => {
    const store = createScanStore(customData(), { now: () => NOW })

    const created = store.createSession({ sessionName: '회차', zone: 'X' })

    const links = store.snapshot().sessionShelves.filter((l) => l.sessionId === created.id)
    expect(links).toEqual([
      { sessionId: created.id, shelfId: 1, scanStatus: 'WAITING' },
      { sessionId: created.id, shelfId: 2, scanStatus: 'WAITING' },
    ])
    expect(created.floorNo).toBe(1) // 등록된 활성 서가 층(3, 1)의 최솟값. 비활성 서가의 층(0)은 제외
  })

  it('층 정보가 없는 서가만 등록된 회차의 floorNo는 null이다', () => {
    const store = createScanStore(customData(), { now: () => NOW })
    expect(store.createSession({ sessionName: '회차', zone: 'NOFLOOR' }).floorNo).toBeNull()
  })

  it('완료된 회차만 있는 자료실에는 새 회차를 만들 수 있다', () => {
    const store = newStore()
    const before = store.snapshot()
    const completedOnly = before.sessions.some((s) => s.zone === SEED_ZONES.REFERENCE && s.status === 'COMPLETED')
    const hasOpen = before.sessions.some((s) => s.zone === SEED_ZONES.REFERENCE && s.status !== 'COMPLETED')
    expect({ completedOnly, hasOpen }).toEqual({ completedOnly: true, hasOpen: false })

    expect(() => store.createSession({ sessionName: '회차', zone: SEED_ZONES.REFERENCE })).not.toThrow()
  })

  it.each([
    ['IN_PROGRESS', SEED_ZONES.HUMANITIES],
    ['REVIEW', SEED_ZONES.SOCIAL],
  ] satisfies [ScanSessionStatus, string][])('%s 회차가 있는 자료실은 409 SCAN_002이고 데이터가 바뀌지 않는다', (_status, zone) => {
    const store = newStore()
    const before = store.snapshot()

    expectRejected(() => store.createSession({ sessionName: '중복', zone }), 409, ERROR_CODE.SCAN_SESSION_ALREADY_OPEN)

    expect(store.snapshot()).toEqual(before)
  })

  it('활성 서가가 없는 자료실과 존재하지 않는 자료실은 400 SCAN_003이다', () => {
    const store = newStore()
    expectRejected(
      () => store.createSession({ sessionName: '회차', zone: SEED_ZONES.ARCHIVE }),
      400,
      ERROR_CODE.SCAN_NO_ACTIVE_SHELF,
    )
    expectRejected(
      () => store.createSession({ sessionName: '회차', zone: '없는 자료실' }),
      400,
      ERROR_CODE.SCAN_NO_ACTIVE_SHELF,
    )
  })

  it('검사 순서: 미완료 회차(409)가 활성 서가 없음(400 SCAN_003)보다 먼저 판단된다', () => {
    const data = customData({
      sessions: [
        {
          id: 1,
          sessionName: '진행 중',
          status: 'IN_PROGRESS',
          zone: 'OFF',
          plannedStartDate: null,
          startedAt: '2026-11-01T09:00:00',
          finalizedAt: null,
          createdAt: '2026-11-01T09:00:00',
        },
      ],
      sessionShelves: [{ sessionId: 1, shelfId: 5, scanStatus: 'WAITING' }],
    })
    const store = createScanStore(data, { now: () => NOW })
    expectRejected(() => store.createSession({ sessionName: '회차', zone: 'OFF' }), 409, ERROR_CODE.SCAN_SESSION_ALREADY_OPEN)
  })

  describe('입력값 검증', () => {
    it.each([
      ['빈 문자열', ''],
      ['공백만', '   '],
    ])('회차명이 %s이면 400이고 저장되지 않는다', (_label, sessionName) => {
      const store = newStore()
      const before = store.snapshot()
      const error = expectRejected(
        () => store.createSession({ sessionName, zone: SEED_ZONES.REFERENCE }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
      expect(error.errors.map((e) => e.field)).toEqual(['sessionName'])
      expect(store.snapshot()).toEqual(before)
    })

    it('회차명은 100자까지 허용하고 101자는 400이다', () => {
      const store = newStore()
      expectRejected(
        () => store.createSession({ sessionName: '가'.repeat(101), zone: SEED_ZONES.REFERENCE }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
      expect(store.createSession({ sessionName: '가'.repeat(100), zone: SEED_ZONES.REFERENCE }).sessionName).toHaveLength(100)
    })

    it.each([
      ['빈 문자열', ''],
      ['공백만', ' '],
    ])('자료실이 %s이면 400이다', (_label, zone) => {
      const store = newStore()
      const error = expectRejected(() => store.createSession({ sessionName: '회차', zone }), 400, ERROR_CODE.INVALID_INPUT)
      expect(error.errors.map((e) => e.field)).toEqual(['zone'])
    })

    it('자료실 이름은 30자까지 검증을 통과하고 31자는 400 COMMON_001이다', () => {
      const store = newStore()
      expectRejected(() => store.createSession({ sessionName: '회차', zone: '가'.repeat(30) }), 400, ERROR_CODE.SCAN_NO_ACTIVE_SHELF)
      expectRejected(() => store.createSession({ sessionName: '회차', zone: '가'.repeat(31) }), 400, ERROR_CODE.INVALID_INPUT)
    })

    it('필수값이 모두 잘못되면 필드별 오류를 함께 돌려준다', () => {
      const error = expectRejected(
        () => newStore().createSession({ sessionName: '', zone: '' }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
      expect(error.errors.map((e) => e.field)).toEqual(['sessionName', 'zone'])
    })

    it('요청 본문의 필수값이 없는 경우(null)도 400이다', () => {
      const store = newStore()
      expectRejected(
        () => store.createSession({ sessionName: null, zone: SEED_ZONES.REFERENCE } as never),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
    })
  })

  describe('점검 예정일', () => {
    // 서울 기준 오늘. UTC 날짜와 서울 날짜가 달라지는 시각을 포함한다.
    it.each([
      // [현재 시각(UTC), 서울 오늘, 거부되어야 하는 날짜, 허용되어야 하는 날짜]
      ['2026-06-15T15:30:00Z', '2026-06-16', '2026-06-15', '2026-06-16'],
      ['2026-06-16T14:59:59Z', '2026-06-16', '2026-06-15', '2026-06-16'],
      ['2026-06-16T15:00:00Z', '2026-06-17', '2026-06-16', '2026-06-17'],
      ['2026-11-24T03:00:00Z', '2026-11-24', '2026-11-23', '2026-11-24'],
    ])('현재 %s (서울 %s): 어제(%s)는 거부하고 오늘(%s)은 허용한다', (utc, _seoulToday, yesterday, today) => {
      const store = newStore(Date.parse(utc))
      const before = store.snapshot()

      const error = expectRejected(
        () => store.createSession({ sessionName: '회차', zone: SEED_ZONES.REFERENCE, plannedStartDate: yesterday }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
      expect(error.errors).toEqual([])
      expect(store.snapshot()).toEqual(before)

      expect(store.createSession({ sessionName: '회차', zone: SEED_ZONES.REFERENCE, plannedStartDate: today }).plannedStartDate).toBe(today)
    })

    it('미래 날짜와 예정일 미입력(null, 생략)을 허용한다', () => {
      const store = newStore()
      expect(store.createSession({ sessionName: 'a', zone: SEED_ZONES.REFERENCE, plannedStartDate: '2027-01-01' }).plannedStartDate).toBe('2027-01-01')
      expect(store.createSession({ sessionName: 'b', zone: SEED_ZONES.MULTIMEDIA, plannedStartDate: null }).plannedStartDate).toBeNull()
    })

    it('예정일을 생략하면 null로 저장한다', () => {
      expect(newStore().createSession({ sessionName: 'a', zone: SEED_ZONES.REFERENCE }).plannedStartDate).toBeNull()
    })

    it('윤년의 2월 29일은 허용하고 평년의 2월 29일은 거부한다 (Date 자동 보정 없음)', () => {
      const store = newStore()
      expect(store.createSession({ sessionName: 'a', zone: SEED_ZONES.REFERENCE, plannedStartDate: '2028-02-29' }).plannedStartDate).toBe('2028-02-29')
      expectRejected(
        () => store.createSession({ sessionName: 'b', zone: SEED_ZONES.MULTIMEDIA, plannedStartDate: '2027-02-29' }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
    })

    it.each([
      ['2월 30일', '2027-02-30'],
      ['13월', '2026-13-01'],
      ['0월', '2026-00-10'],
      ['4월 31일', '2026-04-31'],
      ['32일', '2026-12-32'],
      ['자릿수 부족', '2026-1-1'],
      ['구분자 없음', '20261201'],
      ['시각 포함', '2026-12-01T00:00:00'],
      ['앞 공백', ' 2026-12-01'],
      ['빈 문자열', ''],
    ])('잘못된 날짜(%s: "%s")는 400이고 저장되지 않는다', (_label, plannedStartDate) => {
      const store = newStore()
      const before = store.snapshot()
      const error = expectRejected(
        () => store.createSession({ sessionName: '회차', zone: SEED_ZONES.REFERENCE, plannedStartDate }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
      expect(error.errors).toEqual([])
      expect(store.snapshot()).toEqual(before)
    })

    it('날짜 형식 오류는 필드 검증 오류보다 먼저 처리된다 (본문 파싱 단계, errors 없음)', () => {
      const error = expectRejected(
        () => newStore().createSession({ sessionName: '', zone: '', plannedStartDate: '2026-02-30' }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
      expect(error.errors).toEqual([])
    })

    it('예정일 오류는 미완료 회차 검사(409)보다 먼저 처리된다', () => {
      expectRejected(
        () => newStore().createSession({ sessionName: '회차', zone: SEED_ZONES.HUMANITIES, plannedStartDate: '2020-01-01' }),
        400,
        ERROR_CODE.INVALID_INPUT,
      )
    })
  })

  it('생성 후 상세, 목록, 자료실 상태가 같은 데이터로 일치한다', () => {
    const store = newStore()
    const before = store.getRooms().find((r) => r.zone === SEED_ZONES.REFERENCE)
    expect(before?.hasOpenSession).toBe(false)

    const created = store.createSession({ sessionName: '일관성', zone: SEED_ZONES.REFERENCE })

    expect(store.getSession(created.id)).toEqual(created)
    expect(store.getSessions().content[0]).toEqual(created)
    expect(store.getSessions({ status: ['IN_PROGRESS'] }).content.map((s) => s.id)).toContain(created.id)
    expect(store.getSessions({ status: ['COMPLETED'] }).content.map((s) => s.id)).not.toContain(created.id)
    expect(store.getRooms().find((r) => r.zone === SEED_ZONES.REFERENCE)?.hasOpenSession).toBe(true)
    expectRejected(
      () => store.createSession({ sessionName: '또 생성', zone: SEED_ZONES.REFERENCE }),
      409,
      ERROR_CODE.SCAN_SESSION_ALREADY_OPEN,
    )
    expect(findInvariantViolations(store.snapshot())).toEqual([])
  })

  it('같은 시각에 만든 회차는 id 내림차순으로 정렬되고 ID는 계속 증가한다', () => {
    const store = newStore()
    const first = store.createSession({ sessionName: '첫째', zone: SEED_ZONES.REFERENCE })
    const second = store.createSession({ sessionName: '둘째', zone: SEED_ZONES.MULTIMEDIA })

    expect(second.id).toBe(first.id + 1)
    expect(second.createdAt).toBe(first.createdAt)
    expect(store.getSessions().content.slice(0, 2).map((s) => s.id)).toEqual([second.id, first.id])
  })

  it('입력으로 받은 초기 데이터를 변경하지 않고, 저장소끼리 상태를 공유하지 않는다', () => {
    const seed = createSeedData()
    const copy = structuredClone(seed)
    const a = createScanStore(seed, { now: () => NOW })
    const b = createScanStore(seed, { now: () => NOW })

    a.createSession({ sessionName: 'a', zone: SEED_ZONES.REFERENCE })

    expect(seed).toEqual(copy)
    expect(b.getSessions().totalElements).toBe(31)
    expect(a.getSessions().totalElements).toBe(32)
  })
})

describe('회차 목록 조회', () => {
  it('상태 필터가 없으면 전체를 조회한다', () => {
    expect(newStore().getSessions().totalElements).toBe(31)
    expect(newStore().getSessions({ status: [] }).totalElements).toBe(31)
  })

  it.each([
    ['IN_PROGRESS', 1],
    ['REVIEW', 3],
    ['COMPLETED', 27],
  ] satisfies [ScanSessionStatus, number][])('단일 상태 %s 필터는 해당 상태만 돌려준다 (%i건)', (status, total) => {
    const result = newStore().getSessions({ status: [status], size: 100 })
    expect(result.totalElements).toBe(total)
    expect(result.content.every((s) => s.status === status)).toBe(true)
  })

  it('복수 상태 필터는 해당 상태들의 합집합을 돌려준다', () => {
    const result = newStore().getSessions({ status: ['IN_PROGRESS', 'REVIEW'], size: 100 })
    expect(result.totalElements).toBe(4)
    expect(new Set(result.content.map((s) => s.status))).toEqual(new Set(['IN_PROGRESS', 'REVIEW']))
  })

  it('알 수 없는 상태 값은 400이다', () => {
    expectRejected(() => newStore().getSessions({ status: ['UNKNOWN' as ScanSessionStatus] }), 400, ERROR_CODE.INVALID_INPUT)
  })

  it('createdAt 내림차순, 같은 createdAt이면 id 내림차순으로 정렬한다', () => {
    const { content } = newStore().getSessions({ size: 100 })
    for (let i = 1; i < content.length; i++) {
      const prev = content[i - 1]
      const cur = content[i]
      expect(prev.createdAt >= cur.createdAt).toBe(true)
      if (prev.createdAt === cur.createdAt) expect(prev.id).toBeGreaterThan(cur.id)
    }
    // 같은 시각의 회차가 실제로 여러 개 있는 구간을 포함하는지 확인 (2025-12-01: 이력 4개 + 시나리오 1개)
    const sameTime = content.filter((s) => s.createdAt === '2025-12-01T09:00:00')
    expect(sameTime.length).toBeGreaterThan(1)
    expect(sameTime.map((s) => s.id)).toEqual([...sameTime.map((s) => s.id)].sort((a, b) => b - a))
  })

  describe('페이지네이션', () => {
    it('기본값은 page 0, size 20이고 총 건수와 페이지 수를 돌려준다', () => {
      const result = newStore().getSessions()
      expect(result).toMatchObject({ page: 0, size: 20, totalElements: 31, totalPages: 2 })
      expect(result.content).toHaveLength(20)
    })

    it('마지막 페이지는 남은 건수만 돌려준다', () => {
      const result = newStore().getSessions({ page: 1, size: 20 })
      expect(result.content).toHaveLength(11)
      expect(result).toMatchObject({ page: 1, totalElements: 31, totalPages: 2 })
    })

    it('모든 페이지를 이어 붙이면 중복 없이 전체 회차가 최신순으로 나온다', () => {
      const store = newStore()
      const ids: number[] = []
      for (let page = 0; page < 5; page++) ids.push(...store.getSessions({ page, size: 7 }).content.map((s) => s.id))
      expect(ids).toHaveLength(31)
      expect(new Set(ids).size).toBe(31)
      expect(ids).toEqual(store.getSessions({ size: 100 }).content.map((s) => s.id))
    })

    it('범위를 벗어난 페이지는 빈 목록이며 총 건수와 페이지 수는 유지한다', () => {
      const result = newStore().getSessions({ page: 2, size: 20 })
      expect(result.content).toEqual([])
      expect(result).toMatchObject({ page: 2, size: 20, totalElements: 31, totalPages: 2 })
    })

    it('결과가 없으면 totalPages가 0이다', () => {
      const store = createScanStore(customData(), { now: () => NOW })
      expect(store.getSessions()).toEqual({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })
    })

    it('size는 1~100으로, 음수 page는 0으로 보정하고 응답에는 보정된 값을 담는다', () => {
      const store = newStore()
      expect(store.getSessions({ size: 1000 }).size).toBe(100)
      expect(store.getSessions({ size: 0 })).toMatchObject({ size: 1, totalPages: 31 })
      expect(store.getSessions({ size: -5 }).size).toBe(1)
      expect(store.getSessions({ page: -3 }).page).toBe(0)
    })

    it('offset이 int 최댓값을 넘으면 400이고, 같거나 작으면 빈 목록이다', () => {
      const store = newStore()
      for (const [page, size] of [
        [2_147_483_647, 100],
        [2_147_483_647, 2],
        [100_000_000, 100],
      ]) {
        expectRejected(() => store.getSessions({ page, size }), 400, ERROR_CODE.INVALID_INPUT)
      }
      expect(store.getSessions({ page: 1_000_000, size: 20 }).content).toEqual([])
      expect(store.getSessions({ page: 2_147_483_647, size: 1 }).content).toEqual([]) // offset == 최댓값은 허용
    })

    it('정수가 아닌 page, size는 400이다', () => {
      expectRejected(() => newStore().getSessions({ page: 1.5 }), 400, ERROR_CODE.INVALID_INPUT)
      expectRejected(() => newStore().getSessions({ size: Number.NaN }), 400, ERROR_CODE.INVALID_INPUT)
    })
  })
})

describe('회차 상세 조회', () => {
  it('상세는 목록의 같은 회차와 완전히 같은 DTO다', () => {
    const store = newStore()
    for (const item of store.getSessions({ size: 100 }).content) {
      expect(store.getSession(item.id)).toEqual(item)
    }
  })

  it('상태에서 processingStage를 계산한다', () => {
    const store = newStore()
    expect(store.getSession(SEED_SESSION_IDS.VISION_WAITING)).toMatchObject({ status: 'IN_PROGRESS', processingStage: 'VISION_WAITING', finalizedAt: null })
    expect(store.getSession(SEED_SESSION_IDS.REVIEW_PARTIAL)).toMatchObject({ status: 'REVIEW', processingStage: 'ANALYSIS_DONE', finalizedAt: null })
    expect(store.getSession(SEED_SESSION_IDS.COMPLETED_PENDING)).toMatchObject({
      status: 'COMPLETED',
      processingStage: 'ANALYSIS_DONE',
      finalizedAt: '2026-06-20T17:30:00',
    })
  })

  it('floorNo는 회차에 등록된 서가 층의 최솟값이다', () => {
    const store = newStore()
    expect(store.getSession(SEED_SESSION_IDS.VISION_WAITING).floorNo).toBe(3)
    expect(store.getSession(SEED_SESSION_IDS.REVIEW_COMPLETE).floorNo).toBe(4)
  })

  it('존재하지 않는 회차는 404 SCAN_001이다', () => {
    expectRejected(() => newStore().getSession(99_999), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
    expectRejected(() => newStore().getSession(0), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
    expectRejected(() => newStore().getSession(-1), 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND)
  })

  it('정수가 아닌 ID는 400이다', () => {
    expectRejected(() => newStore().getSession(Number.NaN), 400, ERROR_CODE.INVALID_INPUT)
    expectRejected(() => newStore().getSession(1.5), 400, ERROR_CODE.INVALID_INPUT)
  })

  it('반환값을 바꿔도 저장소에는 영향이 없다', () => {
    const store = newStore()
    const detail = store.getSession(1)
    detail.sessionName = '변경'
    store.getSessions().content[0].sessionName = '변경'
    expect(store.getSession(1).sessionName).toBe('2026년 2학기 정기 장서점검')
  })
})

describe('자료실 조회', () => {
  it('활성 서가가 있는 자료실만 이름 순으로 돌려주고 서가 수와 최소 층을 계산한다', () => {
    const rooms = newStore().getRooms()
    expect(rooms.map((r) => r.zone)).toEqual([...rooms.map((r) => r.zone)].sort())
    expect(rooms.find((r) => r.zone === SEED_ZONES.HUMANITIES)).toEqual({
      zone: SEED_ZONES.HUMANITIES,
      floorNo: 3,
      shelfCount: 3, // 비활성 서가 1개는 제외
      hasOpenSession: true,
    })
    expect(rooms.find((r) => r.zone === SEED_ZONES.MULTIMEDIA)).toMatchObject({ floorNo: null, shelfCount: 1 })
  })

  it('hasOpenSession은 모든 자료실에서 실제 미완료 회차 존재 여부와 일치한다', () => {
    const store = newStore()
    const { sessions } = store.snapshot()
    for (const room of store.getRooms()) {
      const open = sessions.some((s) => s.zone === room.zone && s.status !== 'COMPLETED')
      expect(room.hasOpenSession).toBe(open)
    }
  })

  it('자료실 최소 층은 활성 서가만 기준으로 하고, 공백·없는 zone은 자료실에서 제외한다', () => {
    const rooms = createScanStore(customData(), { now: () => NOW }).getRooms()
    expect(rooms.map((r) => r.zone)).toEqual(['NOFLOOR', 'X'])
    expect(rooms.find((r) => r.zone === 'X')).toEqual({ zone: 'X', floorNo: 1, shelfCount: 2, hasOpenSession: false })
  })

  it('반환값을 바꿔도 저장소에는 영향이 없다', () => {
    const store = newStore()
    store.getRooms()[0].hasOpenSession = true
    store.getRooms().pop()
    expect(store.getRooms()).toHaveLength(6)
    expect(store.getRooms()[0].hasOpenSession).toBe(false)
  })
})
