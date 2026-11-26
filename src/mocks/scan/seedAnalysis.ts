import type { ObservationAnalysisStatus, ObservationStatusReason } from '@/types/scan/analysis'
import type { MockBook, MockData, MockObservation, MockSession, MockShelf } from './types'

// 자동 분석 결과의 결정적(deterministic) 시드. 결과를 수신한 회차(REVIEW, COMPLETED)에만 관측을 만든다.
// Backend의 현재 실행 가능한 OCR 원문 매칭 결과만 흉내 낸다: 파싱값과 라벨 원문은 null, 매칭 후보는 없고,
// AMBIGUOUS_MATCH는 만들지 않는다. 매칭 알고리즘은 구현하지 않고 판정 결과를 계획에 직접 적는다.

/** 한 관측으로 표현되는 이상 항목. 중복 관측은 관측 2건이 필요해 duplicates에 따로 적는다. */
type SingleIssue = 'WRONG_SHELF' | 'OCR_FAILED' | 'NO_MATCH' | 'DISPOSED_BOOK' | 'NO_EXPECTED_SHELF'

interface ShelfPlan {
  normal: number
  issues?: SingleIssue[]
  /** 촬영 시각과 가로 위치를 보내지 않은 서가 */
  withoutCaptureInfo?: boolean
}

interface SessionPlan {
  /** 회차 대상 서가의 서가 ID 오름차순 */
  shelves: ShelfPlan[]
  /** 같은 도서가 두 번 관측된 쌍. [예상 서가이기도 한 관측 서가, 두 번째 관측 서가]의 순번 */
  duplicates?: [number, number][]
}

// 회차 ID는 seed.ts의 SEED_SESSION_IDS와 같다. 주석의 값은 전체 = 정상 + 오배치 + 검토 필요.
const SCENARIO_PLANS: Record<number, SessionPlan> = {
  // 128 = 120 + 5 + 3 (시안의 대표 값)
  2: {
    shelves: [
      { normal: 30, issues: ['WRONG_SHELF', 'WRONG_SHELF'] },
      { normal: 30, issues: ['WRONG_SHELF', 'NO_MATCH'] },
      { normal: 30, issues: ['WRONG_SHELF'] },
      { normal: 30, issues: ['WRONG_SHELF'] },
    ],
    duplicates: [[2, 2]],
  },
  // 96 = 83 + 6 + 7: 모든 판정 사유(AMBIGUOUS_MATCH 제외), 서가를 넘는 중복, 시각 없는 서가, 0건 서가
  3: {
    shelves: [
      { normal: 30, issues: ['WRONG_SHELF', 'WRONG_SHELF', 'OCR_FAILED', 'DISPOSED_BOOK'] },
      { normal: 30, issues: ['WRONG_SHELF', 'WRONG_SHELF', 'NO_MATCH', 'NO_EXPECTED_SHELF'] },
      { normal: 23, issues: ['WRONG_SHELF', 'WRONG_SHELF', 'NO_MATCH'], withoutCaptureInfo: true },
      { normal: 0 },
    ],
    duplicates: [[0, 1]],
  },
  // 조회 계약(수신 완료, 관측 0건)을 확인하기 위한 시드다. 모든 서가가 비어 있는 결과를 실제 Vision 수신이
  // 만들 수 있는지와는 별개다. (현재 Backend는 파서 구현체가 없으면 관측이 하나도 없는 수신 요청을 거부한다)
  4: { shelves: [{ normal: 0 }, { normal: 0 }] },
  // 112 = 108 + 3 + 1
  5: {
    shelves: [
      { normal: 36, issues: ['WRONG_SHELF'] },
      { normal: 36, issues: ['WRONG_SHELF', 'NO_MATCH'] },
      { normal: 36, issues: ['WRONG_SHELF'] },
    ],
  },
  // 104 = 99 + 3 + 2
  6: {
    shelves: [
      { normal: 33, issues: ['WRONG_SHELF', 'OCR_FAILED'] },
      { normal: 33, issues: ['WRONG_SHELF'] },
      { normal: 33, issues: ['WRONG_SHELF', 'DISPOSED_BOOK'] },
    ],
  },
  // 90 = 90 + 0 + 0 (이상 없음)
  7: { shelves: [{ normal: 30 }, { normal: 30 }, { normal: 30 }] },
}

/** 이력 회차: 회차 ID로 건수를 정해 항상 같은 결과를 만든다. */
function historyPlan(sessionId: number, shelfCount: number): SessionPlan {
  return {
    shelves: Array.from({ length: shelfCount }, (_, index) => ({
      normal: 8 + ((sessionId + index) % 5),
      issues: [
        ...(index === 0 ? Array<SingleIssue>(sessionId % 3).fill('WRONG_SHELF') : []),
        ...(index === shelfCount - 1 && sessionId % 2 === 1 ? ['NO_MATCH' as const] : []),
      ],
    })),
  }
}

const STATUS_BY_REASON: Record<SingleIssue | 'DUPLICATE_OBSERVATION', ObservationAnalysisStatus> = {
  WRONG_SHELF: 'MISPLACED',
  OCR_FAILED: 'REVIEW_REQUIRED',
  NO_MATCH: 'REVIEW_REQUIRED',
  DISPOSED_BOOK: 'REVIEW_REQUIRED',
  NO_EXPECTED_SHELF: 'REVIEW_REQUIRED',
  DUPLICATE_OBSERVATION: 'REVIEW_REQUIRED',
}

/** 한 서가에 놓을 관측 1건의 판정 */
interface Slot {
  reason: ObservationStatusReason | null
  status: ObservationAnalysisStatus
  bookId: number | null
}

const SPACING_CM = 2.2
const pad = (value: number, length = 2) => String(value).padStart(length, '0')

/** 이상 항목을 정상 도서 사이(5번째 간격)에 끼워 넣는다. */
function interleave(normals: Slot[], issues: Slot[]): Slot[] {
  const slots = [...normals]
  issues.forEach((issue, index) => slots.splice(Math.min((index + 1) * 5 - 1, slots.length), 0, issue))
  return slots
}

export function buildSeedAnalysis(
  source: Pick<MockData, 'shelves' | 'sessions' | 'sessionShelves'>,
): Pick<MockData, 'books' | 'observations'> {
  const books: MockBook[] = []
  const observations: MockObservation[] = []
  const shelvesById = new Map(source.shelves.map((shelf) => [shelf.id, shelf]))
  // 같은 서가의 정상 도서는 회차가 달라도 같은 도서다.
  const catalog = new Map<string, number>()

  function addBook(shelf: MockShelf, overrides: Partial<MockBook> = {}): number {
    const id = books.length + 1
    books.push({
      id,
      registrationNo: `EM${pad(id, 7)}`,
      title: `${shelf.shelfCode} 소장 도서 ${id}`,
      callNumber: `${shelf.id * 10 + 100}.${(id % 9) + 1} 가${pad(id, 4)}`,
      copyNumber: id % 9 === 0 ? 'c.2' : null,
      lifecycleStatus: 'NORMAL',
      expectedShelfId: shelf.id,
      widthCm: id % 7 === 0 ? null : 2.1,
      ...overrides,
    })
    return id
  }

  function catalogBook(shelf: MockShelf, position: number): number {
    const key = `${shelf.id}:${position}`
    let id = catalog.get(key)
    if (id === undefined) {
      id = addBook(shelf)
      catalog.set(key, id)
    }
    return id
  }

  function addSession(session: MockSession): void {
    const shelves = source.sessionShelves
      .filter((link) => link.sessionId === session.id)
      .map((link) => shelvesById.get(link.shelfId) as MockShelf)
      .sort((a, b) => a.id - b.id)
    const plan = SCENARIO_PLANS[session.id] ?? historyPlan(session.id, shelves.length)
    if (plan.shelves.length !== shelves.length) {
      throw new Error(`회차 ${session.id}: 시드 계획의 서가 수가 대상 서가 수와 다릅니다`)
    }

    // 이상 항목의 도서는 회차마다 새로 만들어 다른 회차의 도서 상태에 영향을 주지 않는다.
    function issueSlot(reason: SingleIssue, index: number): Slot {
      const shelf = shelves[index]
      const status = STATUS_BY_REASON[reason]
      switch (reason) {
        case 'OCR_FAILED':
        case 'NO_MATCH':
          return { reason, status, bookId: null }
        case 'WRONG_SHELF':
          return { reason, status, bookId: addBook(shelves[(index + 1) % shelves.length]) }
        case 'DISPOSED_BOOK':
          return { reason, status, bookId: addBook(shelf, { lifecycleStatus: 'DISPOSED' }) }
        case 'NO_EXPECTED_SHELF':
          return { reason, status, bookId: addBook(shelf, { expectedShelfId: null }) }
      }
    }

    const issuesByShelf = plan.shelves.map((shelfPlan, index) =>
      (shelfPlan.issues ?? []).map((reason) => issueSlot(reason, index)),
    )
    for (const [first, second] of plan.duplicates ?? []) {
      const bookId = addBook(shelves[first])
      for (const index of [first, second]) {
        const reason = 'DUPLICATE_OBSERVATION'
        issuesByShelf[index].push({ reason, status: STATUS_BY_REASON[reason], bookId })
      }
    }

    const date = session.createdAt.slice(0, 10)
    let sequence = 0 // 회차 안의 촬영 순번 (10초 간격)
    plan.shelves.forEach((shelfPlan, index) => {
      const shelf = shelves[index]
      const normals: Slot[] = Array.from({ length: shelfPlan.normal }, (_, position) => ({
        reason: null,
        status: 'NORMAL',
        bookId: catalogBook(shelf, position),
      }))
      interleave(normals, issuesByShelf[index]).forEach((slot, position) => {
        const id = observations.length + 1
        const seconds = sequence++ * 10
        observations.push({
          id,
          sessionId: session.id,
          shelfId: shelf.id,
          detectedOrder: position + 1,
          xPositionCm: shelfPlan.withoutCaptureInfo ? null : Math.round(position * SPACING_CM * 100) / 100,
          detectedLabelRaw: null,
          detectedTitle: null,
          detectedClassificationNo: null,
          detectedBookSymbol: null,
          detectedCopyNumber: null,
          detectedAt: shelfPlan.withoutCaptureInfo
            ? null
            : `${date}T10:${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`,
          receivedAt: `${date}T11:00:00`,
          analysisStatus: slot.status,
          statusReason: slot.reason,
          // 원문이 그대로 일치하면 1.0. 0.95는 원문의 글자가 순서대로 나오되 사이에 한 글자가 낀 부분 일치의 점수다.
          matchConfidence: slot.bookId === null ? null : id % 8 === 0 ? 0.95 : 1,
          bookId: slot.bookId,
          candidates: [],
        })
      })
    })
  }

  for (const session of source.sessions) {
    if (session.status !== 'IN_PROGRESS') addSession(session)
  }
  return { books, observations }
}
