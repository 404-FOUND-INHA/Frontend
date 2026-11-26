import { buildSeedAnalysis } from './seedAnalysis'
import { buildSeedReviews } from './seedReview'
import type { MockData, MockScanShelfStatus, MockSession, MockSessionShelf, MockShelf } from './types'

// 결정적(deterministic) 시드 데이터. 호출할 때마다 새 객체를 만들어 테스트와 화면 확인을 반복 가능하게 한다.
// 시안의 예시 값과 Backend 규칙(자료실당 미완료 회차 1개 등)이 충돌하면 규칙과 정합성을 우선한다.

export const SEED_ZONES = {
  HUMANITIES: '인문과학정보실',
  SOCIAL: '사회과학정보실',
  SCIENCE: '자연과학정보실',
  PERIODICALS: '정기간행물실',
  REFERENCE: '참고열람실',
  MULTIMEDIA: '멀티미디어실', // 층 정보가 없는 자료실
  ARCHIVE: '보존서고', // 활성 서가가 없어 자료실 목록에 나오지 않음
} as const

/**
 * 분석·검토·후보 Mock이 같은 회차를 쓰도록 ID를 고정한다.
 * 1~7은 시나리오 회차이고, 이력 회차는 100번부터 시작한다. 필수 검토는 자동 분석이 REVIEW_REQUIRED인 관측이다.
 */
export const SEED_SESSION_IDS = {
  VISION_WAITING: 1, // IN_PROGRESS (인문과학정보실)
  REVIEW_PARTIAL: 2, // REVIEW, 필수 검토 3건 중 2건 완료
  REVIEW_COMPLETE: 3, // REVIEW, 필수 검토 7건 모두 완료
  REVIEW_NONE: 4, // REVIEW, 필수 검토 0건 (관측도 0건)
  COMPLETED_PENDING: 5, // COMPLETED, 필수 검토 1건
  COMPLETED_READY: 6, // COMPLETED, 필수 검토 2건
  COMPLETED_EMPTY: 7, // COMPLETED, 필수 검토 0건 (이상 없음)
} as const

const HISTORY_FIRST_ID = 100

interface ZoneSpec {
  zone: string
  prefix: string
  floorNo: number | null
  active: number
  inactive: number
}

// 서가 ID는 이 순서대로 1부터 부여된다. (인문 1~4, 사회 5~8, 자연 9~12, 정기 13~14, 참고 15~16, 멀티 17, 보존 18~19)
const ZONE_SPECS: ZoneSpec[] = [
  { zone: SEED_ZONES.HUMANITIES, prefix: 'A', floorNo: 3, active: 3, inactive: 1 },
  { zone: SEED_ZONES.SOCIAL, prefix: 'B', floorNo: 3, active: 4, inactive: 0 },
  { zone: SEED_ZONES.SCIENCE, prefix: 'C', floorNo: 4, active: 4, inactive: 0 },
  { zone: SEED_ZONES.PERIODICALS, prefix: 'D', floorNo: 2, active: 2, inactive: 0 },
  { zone: SEED_ZONES.REFERENCE, prefix: 'E', floorNo: 2, active: 2, inactive: 0 },
  { zone: SEED_ZONES.MULTIMEDIA, prefix: 'F', floorNo: null, active: 1, inactive: 0 },
  { zone: SEED_ZONES.ARCHIVE, prefix: 'Z', floorNo: 1, active: 0, inactive: 2 },
]

const SHELF_WIDTH_CM = 90
// 폭 정보가 없는 서가 (shelfWidthCm null 확인용)
const SHELF_CODES_WITHOUT_WIDTH = new Set(['D-02', 'F-01'])

function buildShelves(): MockShelf[] {
  const shelves: MockShelf[] = []
  let id = 1
  for (const spec of ZONE_SPECS) {
    const total = spec.active + spec.inactive
    for (let n = 1; n <= total; n++) {
      const shelfCode = `${spec.prefix}-${String(n).padStart(2, '0')}`
      shelves.push({
        id: id++,
        shelfCode,
        zone: spec.zone,
        floorNo: spec.floorNo,
        widthCm: SHELF_CODES_WITHOUT_WIDTH.has(shelfCode) ? null : SHELF_WIDTH_CM,
        displayOrder: n,
        active: n <= spec.active,
      })
    }
  }
  return shelves
}

function scenarioSessions(): MockSession[] {
  const base = { plannedStartDate: null, finalizedAt: null }
  return [
    // 진행 중(Vision 결과 대기): 시안 목록 첫 카드
    { ...base, id: 1, sessionName: '2026년 2학기 정기 장서점검', status: 'IN_PROGRESS', zone: SEED_ZONES.HUMANITIES, plannedStartDate: '2026-11-02', startedAt: '2026-11-02T09:00:00', createdAt: '2026-11-02T09:00:00' },
    { ...base, id: 2, sessionName: '2026년 2학기 정기 장서점검', status: 'REVIEW', zone: SEED_ZONES.SOCIAL, startedAt: '2026-11-03T09:00:00', createdAt: '2026-11-03T09:00:00' },
    { ...base, id: 3, sessionName: '2026년 2학기 정기 장서점검', status: 'REVIEW', zone: SEED_ZONES.SCIENCE, startedAt: '2026-11-04T09:00:00', createdAt: '2026-11-04T09:00:00' },
    { ...base, id: 4, sessionName: '2026년 2학기 정기 장서점검', status: 'REVIEW', zone: SEED_ZONES.PERIODICALS, startedAt: '2026-11-05T09:00:00', createdAt: '2026-11-05T09:00:00' },
    // 완료: 시안 목록의 완료 카드 3개 (2026.06.20 / 2025.12.15 / 2025.06.18 완료)
    { ...base, id: 5, sessionName: '2026년 1학기 정기 장서점검', status: 'COMPLETED', zone: SEED_ZONES.HUMANITIES, plannedStartDate: '2026-06-08', startedAt: '2026-06-08T09:00:00', finalizedAt: '2026-06-20T17:30:00', createdAt: '2026-06-08T09:00:00' },
    { ...base, id: 6, sessionName: '2025년 2학기 정기 장서점검', status: 'COMPLETED', zone: SEED_ZONES.HUMANITIES, plannedStartDate: '2025-12-01', startedAt: '2025-12-01T09:00:00', finalizedAt: '2025-12-15T17:30:00', createdAt: '2025-12-01T09:00:00' },
    { ...base, id: 7, sessionName: '2025년 1학기 정기 장서점검', status: 'COMPLETED', zone: SEED_ZONES.HUMANITIES, plannedStartDate: '2025-06-02', startedAt: '2025-06-02T09:00:00', finalizedAt: '2025-06-18T17:30:00', createdAt: '2025-06-02T09:00:00' },
  ]
}

// 같은 학기의 회차는 자료실이 달라도 createdAt이 같아, 동일 시각의 id 내림차순 정렬을 검증할 수 있다.
const HISTORY_ZONES = [SEED_ZONES.SOCIAL, SEED_ZONES.SCIENCE, SEED_ZONES.PERIODICALS, SEED_ZONES.REFERENCE]
const HISTORY_TERMS: [year: number, term: 1 | 2][] = [
  [2023, 1],
  [2023, 2],
  [2024, 1],
  [2024, 2],
  [2025, 1],
  [2025, 2],
]

function historySessions(): MockSession[] {
  const sessions: MockSession[] = []
  let id = HISTORY_FIRST_ID
  for (const [year, term] of HISTORY_TERMS) {
    const startDate = term === 1 ? `${year}-06-02` : `${year}-12-01`
    const endDate = term === 1 ? `${year}-06-16` : `${year}-12-15`
    for (const zone of HISTORY_ZONES) {
      sessions.push({
        id: id++,
        sessionName: `${year}년 ${term}학기 정기 장서점검`,
        status: 'COMPLETED',
        zone,
        plannedStartDate: startDate,
        startedAt: `${startDate}T09:00:00`,
        finalizedAt: `${endDate}T17:30:00`,
        createdAt: `${startDate}T09:00:00`,
      })
    }
  }
  return sessions
}

/** 회차 생성 시점의 활성 서가를 대상 서가로 등록한다. 결과를 수신한 회차(REVIEW, COMPLETED)는 서가가 모두 수신 상태이다. */
function buildSessionShelves(sessions: MockSession[], shelves: MockShelf[]): MockSessionShelf[] {
  return sessions.flatMap((session) => {
    const scanStatus: MockScanShelfStatus = session.status === 'IN_PROGRESS' ? 'WAITING' : 'RESULT_RECEIVED'
    return shelves
      .filter((shelf) => shelf.active && shelf.zone === session.zone)
      .map((shelf) => ({ sessionId: session.id, shelfId: shelf.id, scanStatus }))
  })
}

export function createSeedData(): MockData {
  const shelves = buildShelves()
  const sessions = [...scenarioSessions(), ...historySessions()]
  const sessionShelves = buildSessionShelves(sessions, shelves)
  const { books, observations } = buildSeedAnalysis({ shelves, sessions, sessionShelves })
  return { shelves, sessions, sessionShelves, observations, ...buildSeedReviews({ sessions, books, observations }) }
}
