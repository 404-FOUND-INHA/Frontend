import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { findInvariantViolations } from './invariants'
import { SEED_SESSION_IDS, SEED_ZONES, createSeedData } from './seed'
import { createScanStore } from './store'
import type { MockData } from './types'

const { COMPLETED_LATEST, COMPLETED_PREVIOUS, REVIEW_COMPLETE } = SEED_SESSION_IDS
const storeOf = (data: MockData = createSeedData()) => createScanStore(data)
const codes = (shelves: { shelfCode: string }[]) => shelves.map((s) => s.shelfCode)

function errorOf(run: () => unknown): [number, string] {
  try {
    run()
  } catch (error) {
    const { status, code } = error as ApiError
    return [status, code]
  }
  throw new Error('오류가 필요합니다')
}

describe('서가 목록', () => {
  it('기본은 사용 중 서가만이고, 비활성을 포함해 자료실로 거를 수 있다', () => {
    const store = storeOf()
    expect(codes(store.getShelves({ zone: SEED_ZONES.HUMANITIES }))).toEqual(['A-01', 'A-02', 'A-03'])
    expect(codes(store.getShelves({ zone: ` ${SEED_ZONES.HUMANITIES} `, includeInactive: true }))).toEqual([
      'A-01',
      'A-02',
      'A-03',
      'A-04',
    ])
    expect(store.getShelves({ zone: '없는 자료실' })).toEqual([])
    // 공백 자료실은 전체다.
    expect(store.getShelves({ zone: '  ', includeInactive: true })).toHaveLength(createSeedData().shelves.length)
    expect(errorOf(() => store.getShelves({ includeInactive: 'true' as unknown as boolean }))).toEqual([
      400,
      ERROR_CODE.INVALID_INPUT,
    ])
  })

  it('표시 순서(없으면 뒤), 서가 ID 순이다', () => {
    const data = createSeedData()
    const orders: Record<string, number | null> = { 'A-01': null, 'A-02': 2, 'A-03': 1 }
    data.shelves.forEach((s) => s.shelfCode in orders && (s.displayOrder = orders[s.shelfCode]))
    expect(codes(storeOf(data).getShelves({ zone: SEED_ZONES.HUMANITIES }))).toEqual(['A-03', 'A-02', 'A-01'])
  })

  it('도서 수는 현재 서가가 그 서가인 도서의 수다', () => {
    const data = createSeedData()
    const store = storeOf(data)
    for (const shelf of store.getShelves({ includeInactive: true })) {
      expect(shelf.bookCount).toBe(data.books.filter((b) => b.currentShelfId === shelf.id).length)
    }
  })

  it('시드는 위치를 등록하지 않은 서가와 크기가 없는 서가를 가지며 정합성을 지킨다', () => {
    const shelves = storeOf().getShelves({ includeInactive: true })
    expect(codes(shelves.filter((s) => s.mapX === null || s.mapY === null))).toEqual(['F-01', 'B-04'])
    expect(shelves.find((s) => s.shelfCode === 'D-02')).toMatchObject({ mapX: 200, mapY: 40, widthCm: null })
    expect(findInvariantViolations(createSeedData())).toEqual([])
  })
})

describe('서가별 폐기 검토 후보', () => {
  it('회차 전체의 후보를 담고 목록 조회와 서가·점수가 일치한다', () => {
    const store = storeOf()
    const list = store.getDisposalCandidates(COMPLETED_LATEST, { size: 100 }).page.content
    const { totalCandidates, shelves } = store.getDisposalCandidatesByShelf(COMPLETED_LATEST)

    expect(totalCandidates).toBe(23)
    expect(shelves.reduce((sum, g) => sum + g.candidateCount, 0)).toBe(23)
    for (const group of shelves) {
      const items = list.filter((item) => item.shelf?.shelfId === group.shelf?.shelfId)
      expect(group.shelf).toEqual(items[0].shelf)
      expect(group.books.map((b) => [b.bookId, b.finalScore])).toEqual(items.map((i) => [i.bookId, i.finalScore]))
      expect([group.candidateCount, group.maxScore]).toEqual([items.length, items[0].finalScore])
    }
  })

  it('후보 수가 많은 순, 같으면 서가 코드 순이고 서가 미지정은 마지막이다', () => {
    const data = createSeedData()
    // 후보를 A-02에 1권, A-01에 1권, A-03에 2권, 서가 미지정에 19권 둔다.
    const placed: (number | null)[] = [2, 1, 3, 3]
    data.evaluations
      .filter((e) => e.sessionId === COMPLETED_LATEST && e.candidateStatus === 'DISPOSAL_REVIEW')
      .forEach((e, index) => (data.books.find((b) => b.id === e.bookId)!.currentShelfId = placed[index] ?? null))

    const { shelves } = storeOf(data).getDisposalCandidatesByShelf(COMPLETED_LATEST)

    expect(shelves.map((g) => [g.shelf?.shelfCode ?? null, g.candidateCount])).toEqual([
      ['A-03', 2],
      ['A-01', 1],
      ['A-02', 1],
      [null, 19],
    ])
  })

  it('후보가 없으면 빈 목록이고, 회차가 없거나 ID가 잘못되면 오류다', () => {
    const store = storeOf()
    for (const sessionId of [COMPLETED_PREVIOUS, REVIEW_COMPLETE]) {
      expect(store.getDisposalCandidatesByShelf(sessionId)).toEqual({ totalCandidates: 0, shelves: [] })
    }
    expect(errorOf(() => store.getDisposalCandidatesByShelf(999))).toEqual([404, ERROR_CODE.SCAN_SESSION_NOT_FOUND])
    expect(errorOf(() => store.getDisposalCandidatesByShelf(Number.NaN))).toEqual([400, ERROR_CODE.INVALID_INPUT])
  })
})
