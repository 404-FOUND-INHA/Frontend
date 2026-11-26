import { describe, expect, it } from 'vitest'
import { findInvariantViolations } from './invariants'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from './seed'
import { createScanStore } from './store'

describe('시드 데이터', () => {
  it('호출할 때마다 같은 내용의 새 객체를 만든다 (결정적, 공유 참조 없음)', () => {
    const a = createSeedData()
    const b = createSeedData()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    expect(a.sessions).not.toBe(b.sessions)
    a.sessions[0].sessionName = '변경'
    expect(createSeedData().sessions[0].sessionName).not.toBe('변경')
  })

  it('Backend 규칙을 지킨다 (자료실당 미완료 회차 1개 이하, 서가 관계, 상태별 서가 점검 상태, 확정일)', () => {
    expect(findInvariantViolations(createSeedData())).toEqual([])
  })

  it('상태별 필터링과 페이지네이션을 검증할 만큼의 회차를 가진다', () => {
    const { sessions } = createSeedData()
    const count = (status: string) => sessions.filter((s) => s.status === status).length
    expect(sessions).toHaveLength(31)
    expect(count('IN_PROGRESS')).toBe(1)
    expect(count('REVIEW')).toBe(3)
    expect(count('COMPLETED')).toBe(27)
    expect(sessions.length).toBeGreaterThan(20) // 기본 size 20으로 2페이지 이상
  })

  it('시나리오 회차 ID가 고정되어 있고 의도한 상태와 자료실을 가진다', () => {
    const byId = new Map(createSeedData().sessions.map((s) => [s.id, s]))
    const expected = [
      [SEED_SESSION_IDS.VISION_WAITING, 'IN_PROGRESS', SEED_ZONES.HUMANITIES],
      [SEED_SESSION_IDS.REVIEW_PARTIAL, 'REVIEW', SEED_ZONES.SOCIAL],
      [SEED_SESSION_IDS.REVIEW_COMPLETE, 'REVIEW', SEED_ZONES.SCIENCE],
      [SEED_SESSION_IDS.REVIEW_NONE, 'REVIEW', SEED_ZONES.PERIODICALS],
      [SEED_SESSION_IDS.COMPLETED_LATEST, 'COMPLETED', SEED_ZONES.HUMANITIES],
      [SEED_SESSION_IDS.COMPLETED_PREVIOUS, 'COMPLETED', SEED_ZONES.HUMANITIES],
      [SEED_SESSION_IDS.COMPLETED_CLEAN, 'COMPLETED', SEED_ZONES.HUMANITIES],
    ] as const
    for (const [id, status, zone] of expected) {
      expect(byId.get(id)).toMatchObject({ id, status, zone })
    }
  })

  it('서가 ID가 1부터 연속이고, 비활성 서가는 회차의 대상 서가로 등록되지 않는다', () => {
    const { shelves, sessionShelves } = createSeedData()
    expect(shelves.map((s) => s.id)).toEqual(Array.from({ length: shelves.length }, (_, i) => i + 1))
    const inactiveIds = new Set(shelves.filter((s) => !s.active).map((s) => s.id))
    expect(inactiveIds.size).toBeGreaterThan(0)
    expect(sessionShelves.some((link) => inactiveIds.has(link.shelfId))).toBe(false)
  })

  it('같은 createdAt을 가진 회차가 있어 동일 시각의 id 정렬을 검증할 수 있다', () => {
    const { sessions } = createSeedData()
    const sameTime = sessions.filter((s) => s.createdAt === '2025-12-01T09:00:00')
    expect(sameTime.length).toBeGreaterThan(1)
  })

  it('새 회차를 만들 수 있는 자료실(미완료 회차 없음)이 존재한다', () => {
    const rooms = createScanStore(createSeedData()).getRooms()
    const creatable = rooms.filter((room) => !room.hasOpenSession).map((room) => room.zone)
    expect(creatable).toEqual(expect.arrayContaining([SEED_ZONES.REFERENCE, SEED_ZONES.MULTIMEDIA]))
  })

  it('활성 서가가 없는 자료실은 자료실 목록에 나오지 않는다', () => {
    const rooms = createScanStore(createSeedData()).getRooms()
    expect(rooms.map((room) => room.zone)).not.toContain(SEED_ZONES.ARCHIVE)
  })

  it('층 정보가 없는 자료실이 있다 (floorNo null 처리 검증용)', () => {
    const rooms = createScanStore(createSeedData()).getRooms()
    expect(rooms.find((room) => room.zone === SEED_ZONES.MULTIMEDIA)?.floorNo).toBeNull()
  })
})
