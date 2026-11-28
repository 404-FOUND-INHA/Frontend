import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { DisposalCandidateListParams, EvaluationSummary } from '@/types/scan/evaluation'
import { findInvariantViolations } from './invariants'
import { SEED_SESSION_IDS, createSeedData } from './seed'
import { createScanStore } from './store'
import type { MockData, MockEvaluation } from './types'

const NOW = Date.parse('2026-11-26T03:00:00Z')
const storeOf = (data: MockData = createSeedData()) => createScanStore(data, { now: () => NOW })
const { COMPLETED_LATEST, COMPLETED_PREVIOUS, COMPLETED_CLEAN, REVIEW_COMPLETE } = SEED_SESSION_IDS
const MISSING_SESSION = 999

const summary = (total: number, disposalReview: number, keep: number, notEvaluable: number): EvaluationSummary => ({
  total,
  disposalReview,
  keep,
  notEvaluable,
})

describe('평가 현황', () => {
  it.each<[string, number, EvaluationSummary]>([
    ['후보가 있는 회차', COMPLETED_LATEST, summary(111, 23, 85, 3)],
    ['평가했지만 후보가 없는 회차', COMPLETED_PREVIOUS, summary(102, 0, 98, 4)],
    ['모두 평가 불가인 회차', COMPLETED_CLEAN, summary(90, 0, 0, 90)],
    ['평가 결과가 없는 완료 회차', 100, summary(0, 0, 0, 0)],
    ['확정 전 회차', REVIEW_COMPLETE, summary(0, 0, 0, 0)],
  ])('%s', (_label, sessionId, expected) => {
    const response = storeOf().getDisposalCandidates(sessionId)
    expect(response.summary).toStrictEqual(expected)
    expect(response.page.totalElements).toBe(expected.disposalReview)
    expect(response.page.content).toHaveLength(Math.min(expected.disposalReview, 20))
    expect(response.page.totalPages).toBe(Math.ceil(expected.disposalReview / 20))
  })

  it('회차를 확정해도 평가 결과는 만들어지지 않는다', () => {
    const store = storeOf()
    const before = store.snapshot().evaluations
    store.finalizeSession(REVIEW_COMPLETE)
    expect(store.snapshot().evaluations).toStrictEqual(before)
    expect(store.getDisposalCandidates(REVIEW_COMPLETE).summary).toStrictEqual(summary(0, 0, 0, 0))
  })

  it('시드는 정합성을 지키고, 고정 점수는 기본 기준 점수 50점과 판정이 맞는다', () => {
    const data = createSeedData()
    expect(findInvariantViolations(data)).toEqual([])
    for (const { candidateStatus, finalScore } of data.evaluations) {
      if (candidateStatus === 'DISPOSAL_REVIEW') expect(finalScore).toBeGreaterThanOrEqual(50)
      if (candidateStatus === 'KEEP') expect(finalScore).toBeLessThan(50)
    }
  })
})

describe('폐기 검토 후보 목록', () => {
  const all = () => storeOf().getDisposalCandidates(COMPLETED_LATEST, { size: 100 }).page.content

  it('Backend의 필드를 가지며 서가는 도서의 현재 서가다', () => {
    // 도서 219의 정상 배치 서가는 A-02이고, 회차 5에서 A-01에 오배치된 것을 확인했다.
    expect(all().find((item) => item.bookId === 219)).toStrictEqual({
      evaluationId: expect.any(Number),
      bookId: 219,
      title: 'A-02 소장 도서 219',
      registrationNo: 'EM0000219',
      callNumber: expect.any(String),
      finalScore: 72.5,
      candidateStatus: 'DISPOSAL_REVIEW',
      profileVersion: 'default',
      evaluatedAt: '2026-06-22T10:00:00',
      shelf: {
        shelfId: 1,
        shelfCode: 'A-01',
        zone: '인문과학정보실',
        floorNo: 3,
        shelfNo: null,
        levelNo: null,
        mapX: 60,
        mapY: 60,
        mapZ: null,
      },
    })
  })

  it('평가 이후에 원장의 서가가 바뀌면 현재 값이고, 지정되지 않았으면 null이다', () => {
    const data = createSeedData()
    const book = (id: number) => data.books.find((b) => b.id === id)!
    book(219).currentShelfId = null
    book(224).currentShelfId = 9
    const items = storeOf(data).getDisposalCandidates(COMPLETED_LATEST, { size: 100 }).page.content

    expect(items.find((item) => item.bookId === 219)?.shelf).toBeNull()
    expect(items.find((item) => item.bookId === 224)?.shelf?.shelfCode).toBe('C-01')
  })

  it('후보만 담고 점수가 높은 순이며 같으면 도서 ID 순이다', () => {
    const items = all()
    expect(new Set(items.map((item) => item.candidateStatus))).toEqual(new Set(['DISPOSAL_REVIEW']))
    expect(items.slice(0, 6).map((item) => [item.finalScore, item.bookId])).toEqual([
      [94, 269],
      [91.25, 224],
      [88, 239],
      [88, 259],
      [85, 314],
      [83.75, 289],
    ])
    expect(items.filter((item) => item.finalScore === 72.5).map((item) => item.bookId)).toEqual([219, 279, 329])
    expect(items.at(-1)).toMatchObject({ finalScore: 50, bookId: 244 })
  })

  it('저장 순서와 무관하게 정렬한다', () => {
    const data = createSeedData()
    data.evaluations.reverse()
    expect(storeOf(data).getDisposalCandidates(COMPLETED_LATEST, { size: 100 }).page.content).toStrictEqual(all())
  })

  it.each<[DisposalCandidateListParams, number, number, number, number]>([
    [{}, 0, 20, 0, 20],
    [{ page: 1 }, 1, 20, 20, 23],
    [{ page: 2 }, 2, 20, 23, 23],
    [{ page: -1, size: 0 }, 0, 1, 0, 1],
    [{ size: 1000 }, 0, 100, 0, 23],
  ])('%o은 보정해서 나누며 현황은 페이지와 무관하다', (params, page, size, from, to) => {
    const response = storeOf().getDisposalCandidates(COMPLETED_LATEST, params)
    expect(response.summary).toStrictEqual(summary(111, 23, 85, 3))
    expect([response.page.page, response.page.size, response.page.totalElements]).toEqual([page, size, 23])
    expect(response.page.content).toStrictEqual(all().slice(from, to))
  })

  it.each<[string, number, DisposalCandidateListParams, number, string]>([
    ['정수가 아닌 page', MISSING_SESSION, { page: 1.5 }, 400, ERROR_CODE.INVALID_INPUT],
    ['int를 넘는 size', MISSING_SESSION, { size: 2 ** 31 }, 400, ERROR_CODE.INVALID_INPUT],
    ['정수가 아닌 회차 ID', Number.NaN, {}, 400, ERROR_CODE.INVALID_INPUT],
    ['없는 회차', MISSING_SESSION, {}, 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND],
    ['없는 회차의 큰 page', MISSING_SESSION, { page: 2 ** 31 - 1 }, 404, ERROR_CODE.SCAN_SESSION_NOT_FOUND],
    ['page * size가 int 초과', 5, { page: 2 ** 31 - 1 }, 400, ERROR_CODE.INVALID_INPUT],
  ])('오류: %s', (_label, sessionId, params, status, code) => {
    let caught: unknown
    try {
      storeOf().getDisposalCandidates(sessionId, params)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught).toMatchObject({ status, code })
  })

  it('응답을 바꿔도 저장소에는 영향이 없다', () => {
    const store = storeOf()
    const before = store.snapshot()
    const response = store.getDisposalCandidates(COMPLETED_LATEST)
    response.summary.total = 0
    response.page.content[0].shelf!.shelfCode = '변경'
    response.page.content[0].finalScore = 0
    expect(store.snapshot()).toStrictEqual(before)
  })
})

describe('평가 정합성 검사', () => {
  /** 회차 5의 첫 후보(도서 219)와 첫 평가 불가(도서 222) */
  const of = (data: MockData, bookId: number) =>
    data.evaluations.find((e) => e.sessionId === 5 && e.bookId === bookId) as MockEvaluation

  it.each<[string, (d: MockData) => void, string]>([
    ['평가 ID 중복', (d) => (d.evaluations[1].id = 1), '평가 ID가 중복'],
    ['같은 도서의 평가 2건', (d) => d.evaluations.push({ ...of(d, 219), id: 9999 }), '평가가 중복'],
    ['확인하지 않은 도서', (d) => (of(d, 219).bookId = 422), '확인하지 않은 도서 422'],
    ['빠진 확인 도서', (d) => d.evaluations.splice(d.evaluations.indexOf(of(d, 219)), 1), '평가가 빠진 확인 도서: 5:219'],
    ['점수 없는 후보', (d) => (of(d, 219).finalScore = null), '평가 불가일 때만 없어야'],
    ['점수 있는 평가 불가', (d) => (of(d, 222).finalScore = 10), '평가 불가일 때만 없어야'],
    ['범위를 벗어난 점수', (d) => (of(d, 219).finalScore = 100.5), '0~100'],
    ['소수 셋째 자리', (d) => (of(d, 219).finalScore = 72.501), '소수 둘째 자리'],
    ['확정 전 평가', (d) => (of(d, 219).evaluatedAt = '2026-06-20T17:29:59'), '확정 전에 평가'],
    ['평가 시각 형식', (d) => (of(d, 219).evaluatedAt = '2026-06-22'), 'evaluatedAt 형식 오류'],
    ['미완료 회차의 평가', (d) => (of(d, 219).sessionId = REVIEW_COMPLETE), '확정한 회차에만'],
  ])('위반 검출: %s', (_label, corrupt, message) => {
    const data = createSeedData()
    corrupt(data)
    expect(findInvariantViolations(data).join('\n')).toContain(message)
  })
})
