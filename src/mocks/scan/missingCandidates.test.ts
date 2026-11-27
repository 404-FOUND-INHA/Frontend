import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { MissingCandidateListParams, MissingCandidateStatus } from '@/types/scan/missingCandidate'
import { findInvariantViolations, findJudgementViolations } from './invariants'
import { SEED_SESSION_IDS, createSeedData } from './seed'
import { createScanStore } from './store'
import type { MockBook, MockData, MockMissingCandidate } from './types'

const NOW = Date.parse('2026-11-26T03:00:00Z') // 서울 2026-11-26 12:00:00
const storeOf = (data: MockData = createSeedData()) => createScanStore(data, { now: () => NOW })
const MISSING_SESSION = 999

describe('과거 완료 회차의 후보 시드', () => {
  it('시나리오로 정한 회차에만 후보가 있고 다른 회차는 0건이다', () => {
    const data = createSeedData()
    expect(
      data.missingCandidates.map((c) => [c.id, c.sessionId, c.bookId, c.status, c.consecutiveMissingCount]),
    ).toStrictEqual([
      [1, 6, 255, 'FOUND', 1],
      [2, 6, 291, 'RESOLVED', 1],
      [3, 6, 327, 'LOST_CANDIDATE', 1],
      [4, 121, 422, 'NOT_FOUND', 1],
      [5, 5, 330, 'PENDING', 1],
      [6, 5, 332, 'PENDING', 1],
    ])
    expect(findInvariantViolations(data)).toEqual([])
    expect(findJudgementViolations(data)).toEqual([])
  })

  it('조회 응답은 Backend의 필드를 가지며 값이 없는 필드도 null로 담는다', () => {
    const store = storeOf()
    expect(store.getMissingCandidates(121)).toStrictEqual({
      content: [
        {
          candidateId: 4,
          book: { bookId: 422, registrationNo: 'EM0000422', title: '소재불명인 미관측 도서', callNumber: '813.7 미422' },
          expectedShelfId: 9,
          expectedShelfCode: 'C-01',
          consecutiveMissingCount: 1,
          status: 'NOT_FOUND',
          reviewedBy: 1,
          reviewedAt: '2025-12-17T14:00:00',
          note: null,
          createdAt: '2025-12-15T17:30:00',
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    })
    expect(store.getMissingCandidates(SEED_SESSION_IDS.COMPLETED_LATEST).content[0]).toMatchObject({
      status: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      note: null,
    })
  })

  it.each([
    ['후보가 없는 완료 회차', SEED_SESSION_IDS.COMPLETED_CLEAN],
    ['확정 전 회차', SEED_SESSION_IDS.REVIEW_COMPLETE],
    ['수신 전 회차', SEED_SESSION_IDS.VISION_WAITING],
  ])('%s는 오류 없이 빈 목록이다', (_label, sessionId) => {
    expect(storeOf().getMissingCandidates(sessionId)).toStrictEqual({
      content: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
    })
  })
})

describe('확정 후 조회', () => {
  const finalized = () => {
    const store = storeOf()
    const response = store.finalizeSession(SEED_SESSION_IDS.REVIEW_COMPLETE)
    return { store, response }
  }

  it('전체 건수는 확정 응답의 후보 수와 같고 다른 회차의 후보는 섞이지 않는다', () => {
    const { store, response } = finalized()
    const first = store.getMissingCandidates(3)
    const second = store.getMissingCandidates(3, { page: 1 })

    expect(response.summary.missingCandidates).toBe(21)
    expect([first.totalElements, first.totalPages, first.content.length, second.content.length]).toEqual([21, 2, 20, 1])
    const all = [...first.content, ...second.content]
    expect(new Set(all.map((c) => c.candidateId))).toHaveProperty('size', 21)
    expect(new Set(all.map((c) => c.createdAt))).toEqual(new Set([response.finalizedAt]))
    expect(store.getMissingCandidates(121).totalElements).toBe(1)
  })

  it('직전 점검에서도 후보였던 도서는 연속 2회로 맨 앞에 오고, 나머지는 후보 ID 순이다', () => {
    const { store } = finalized()
    const [head, ...rest] = store.getMissingCandidates(3, { size: 100 }).content

    expect([head.book.bookId, head.consecutiveMissingCount, head.status]).toEqual([422, 2, 'PENDING'])
    expect(new Set(rest.map((c) => c.consecutiveMissingCount))).toEqual(new Set([1]))
    const ids = rest.map((c) => c.candidateId)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(findJudgementViolations(store.snapshot())).toEqual([])
  })
})

describe('필터와 페이지', () => {
  it.each<[MissingCandidateStatus | undefined, number[]]>([
    [undefined, [1, 2, 3]],
    ['FOUND', [1]],
    ['LOST_CANDIDATE', [3]],
    ['PENDING', []],
  ])('status %s', (status, ids) => {
    const page = storeOf().getMissingCandidates(SEED_SESSION_IDS.COMPLETED_PREVIOUS, { status })
    expect(page.content.map((c) => c.candidateId)).toEqual(ids)
    expect(page.totalElements).toBe(ids.length)
  })

  it.each<[MissingCandidateListParams, number, number, number[]]>([
    [{ size: 2 }, 0, 2, [1, 2]],
    [{ page: 1, size: 2 }, 1, 2, [3]],
    [{ page: 2, size: 2 }, 2, 2, []],
    [{ page: -1, size: 0 }, 0, 1, [1]],
    [{ size: 1000 }, 0, 100, [1, 2, 3]],
  ])('%o은 보정해서 나눈다', (params, page, size, ids) => {
    const result = storeOf().getMissingCandidates(SEED_SESSION_IDS.COMPLETED_PREVIOUS, params)
    expect([result.page, result.size, result.totalElements]).toEqual([page, size, 3])
    expect(result.content.map((c) => c.candidateId)).toEqual(ids)
  })

  it.each<[string, number, MissingCandidateListParams, number, string]>([
    ['없는 상태', MISSING_SESSION, { status: 'UNKNOWN' as MissingCandidateStatus }, 400, ERROR_CODE.INVALID_INPUT],
    ['정수가 아닌 page', MISSING_SESSION, { page: 1.5 }, 400, ERROR_CODE.INVALID_INPUT],
    ['int를 넘는 size', MISSING_SESSION, { size: 2 ** 31 }, 400, ERROR_CODE.INVALID_INPUT],
    ['정수가 아닌 회차 ID', Number.NaN, {}, 400, ERROR_CODE.INVALID_INPUT],
    ['없는 회차', MISSING_SESSION, {}, 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND],
    ['없는 회차의 큰 page', MISSING_SESSION, { page: 2 ** 31 - 1 }, 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND],
    ['page * size가 int 초과', 5, { page: 2 ** 31 - 1 }, 400, ERROR_CODE.INVALID_INPUT],
  ])('오류: %s', (_label, sessionId, params, status, code) => {
    let caught: unknown
    try {
      storeOf().getMissingCandidates(sessionId, params)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught).toMatchObject({ status, code })
  })
})

describe('연속 미발견 횟수', () => {
  /** 확정할 회차보다 앞서(또는 뒤에) 같은 자료실을 점검한 회차 */
  interface Past {
    id: number
    finalizedAt: string
    /** 그 회차에서 도서가 후보였다면 확인 상태와 당시 횟수 */
    candidate?: [MissingCandidateStatus, number]
    /** 점검한 서가. 도서의 예상 서가는 1이다. */
    shelfId?: number
  }

  /** 회차 100을 확정하면 서가 1의 도서(ID 1)가 관측이 없어 후보가 된다. */
  function dataWith(past: Past[]): MockData {
    const base = { plannedStartDate: null, zone: 'X', startedAt: '2025-01-01T09:00:00', createdAt: '2025-01-01T09:00:00' }
    const candidates: MockMissingCandidate[] = past.flatMap((p, index) => {
      if (!p.candidate) return []
      const [status, consecutiveMissingCount] = p.candidate
      const reviewed = status !== 'PENDING'
      return [
        {
          id: index + 1,
          sessionId: p.id,
          bookId: 1,
          expectedShelfId: 1,
          consecutiveMissingCount,
          status,
          reviewedBy: reviewed ? 1 : null,
          reviewedAt: reviewed ? p.finalizedAt : null,
          note: null,
          createdAt: p.finalizedAt,
        },
      ]
    })
    const shelf = { zone: 'X', floorNo: 1, widthCm: 90, active: true }
    const book: MockBook = {
      id: 1,
      registrationNo: 'T1',
      title: '도서',
      callNumber: '813.7',
      copyNumber: null,
      lifecycleStatus: 'NORMAL',
      expectedShelfId: 1,
      currentShelfId: 1,
      loanStatus: 'AVAILABLE',
      widthCm: 2,
    }
    const completed = past.map((p) => ({
      ...base,
      id: p.id,
      sessionName: `이전 ${p.id}`,
      status: 'COMPLETED' as const,
      finalizedAt: p.finalizedAt,
      finalizedBy: 1,
    }))
    return {
      shelves: [1, 2].map((id) => ({ ...shelf, id, shelfCode: `S-${id}`, displayOrder: id })),
      sessions: [
        ...completed,
        { ...base, id: 100, sessionName: '이번', status: 'REVIEW' as const, finalizedAt: null, finalizedBy: null },
      ],
      sessionShelves: [
        ...past.map((p) => ({ sessionId: p.id, shelfId: p.shelfId ?? 1, scanStatus: 'RESULT_RECEIVED' as const })),
        { sessionId: 100, shelfId: 1, scanStatus: 'RESULT_RECEIVED' as const },
      ],
      books: [book],
      observations: [],
      users: [{ id: 1, name: '사서' }],
      reviews: [],
      missingCandidates: candidates,
      evaluations: [],
    }
  }

  const OLD = '2025-06-01T17:00:00'
  const RECENT = '2025-12-01T17:00:00'

  it.each<[string, Past[], number]>([
    ['점검 이력이 없으면 1', [], 1],
    ['직전에 확인 전이면 +1', [{ id: 1, finalizedAt: RECENT, candidate: ['PENDING', 1] }], 2],
    ['직전에 못 찾았으면 누적', [{ id: 1, finalizedAt: RECENT, candidate: ['NOT_FOUND', 3] }], 4],
    ['직전에 분실 의심이면 누적', [{ id: 1, finalizedAt: RECENT, candidate: ['LOST_CANDIDATE', 2] }], 3],
    ['직전에 찾았으면 1', [{ id: 1, finalizedAt: RECENT, candidate: ['FOUND', 3] }], 1],
    ['직전에 종결했으면 1', [{ id: 1, finalizedAt: RECENT, candidate: ['RESOLVED', 3] }], 1],
    [
      '직전 점검에서 후보가 아니었으면 더 오래된 후보를 보지 않는다 (ID가 아닌 확정 시각 순)',
      [
        { id: 9, finalizedAt: OLD, candidate: ['PENDING', 2] },
        { id: 1, finalizedAt: RECENT },
      ],
      1,
    ],
    [
      '더 최근에 다른 서가만 점검한 회차는 직전 점검이 아니다',
      [
        { id: 1, finalizedAt: OLD, candidate: ['PENDING', 2] },
        { id: 2, finalizedAt: RECENT, shelfId: 2 },
      ],
      3,
    ],
    ['이번 확정보다 늦게 확정한 회차는 보지 않는다', [{ id: 1, finalizedAt: '2027-01-01T17:00:00', candidate: ['PENDING', 1] }], 1],
  ])('%s', (_label, past, expected) => {
    const store = storeOf(dataWith(past))
    store.finalizeSession(100)
    expect(store.getMissingCandidates(100).content.map((c) => c.consecutiveMissingCount)).toEqual([expected])
  })

  it('저장한 횟수가 규칙과 다르면 당시 기준 검사가 알린다', () => {
    const store = storeOf(dataWith([{ id: 1, finalizedAt: RECENT, candidate: ['PENDING', 1] }]))
    store.finalizeSession(100)
    const data = store.snapshot()
    expect(findJudgementViolations(data)).toEqual([])
    data.missingCandidates[1].consecutiveMissingCount = 1
    expect(findJudgementViolations(data)).toEqual(['후보 2: 연속 미발견 횟수는 2여야 함'])
  })
})
