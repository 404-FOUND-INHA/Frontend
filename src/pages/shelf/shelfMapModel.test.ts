import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { SEED_SESSION_IDS, createSeedData } from '@/mocks/scan/seed'
import { createScanStore } from '@/mocks/scan/store'
import type { AnalysisCounts, ScanAnalysisResponse } from '@/types/scan/analysis'
import type { EvaluationSummary, ShelfCandidatesResponse } from '@/types/scan/evaluation'
import type { MissingCandidateResponse, MissingCandidateStatus } from '@/types/scan/missingCandidate'
import type { ShelfResponse } from '@/types/scan/shelf'
import {
  NOT_PRODUCED,
  buildShelfMapModel,
  toSource,
  type ReadySource,
  type ShelfMapSources,
  type Source,
} from './shelfMapModel'

const ready = <T,>(data: T, stale = false): ReadySource<T> => ({ status: 'ready', data, stale })

const shelf = (id: number, overrides: Partial<ShelfResponse> = {}) =>
  ({ id, shelfCode: `S-${id}`, mapX: 10 * id, mapY: 10, active: true, ...overrides }) as ShelfResponse

const counts = (normal: number, misplaced = 0, reviewRequired = 0): AnalysisCounts => ({
  total: normal + misplaced + reviewRequired,
  normal,
  misplaced,
  reviewRequired,
})

type Target = [shelfId: number, counts: AnalysisCounts, scanStatus?: 'WAITING']
const analysisOf = (...targets: Target[]) =>
  ({
    shelves: targets.map(([shelfId, c, scanStatus]) => ({
      shelfId,
      shelfCode: `S-${shelfId}`,
      scanStatus: scanStatus ?? 'RESULT_RECEIVED',
      counts: c,
    })),
  }) as ScanAnalysisResponse

const candidates = (...items: [expectedShelfId: number | null, status?: MissingCandidateStatus][]) =>
  items.map(([expectedShelfId, status = 'PENDING']) => ({ expectedShelfId, status }) as MissingCandidateResponse)

const byShelf = (...groups: [shelfId: number | null, count: number][]) =>
  ({
    totalCandidates: groups.reduce((sum, [, count]) => sum + count, 0),
    shelves: groups.map(([shelfId, candidateCount]) => ({
      shelf: shelfId === null ? null : { shelfId },
      candidateCount,
    })),
  }) as ShelfCandidatesResponse

const summary = (total: number, notEvaluable = 0): EvaluationSummary => ({
  total,
  disposalReview: 0,
  keep: total - notEvaluable,
  notEvaluable,
})

/** 서가 1: 관측 3건 모두 정상, 후보 없음, 평가 불가 없음 */
const clean = (overrides: Partial<ShelfMapSources> = {}): ShelfMapSources => ({
  shelves: ready([shelf(1)]),
  analysis: ready(analysisOf([1, counts(3)])),
  missing: ready(candidates()),
  disposal: ready(byShelf()),
  evaluation: ready(summary(3)),
  ...overrides,
})

function mapOf(sources: ShelfMapSources) {
  const model = buildShelfMapModel(sources)
  if (model.kind !== 'map') throw new Error('배치도 모델이 필요합니다')
  return { ...model, entry: (id: number) => model.entries.find((e) => e.shelfId === id)! }
}

describe('정상 마커', () => {
  it('관측이 있고 모두 정상이며 필요한 후보 결과에 후보가 없을 때 표시한다', () => {
    expect(mapOf(clean()).entry(1).markers).toEqual(['normal'])
  })

  const failed = { status: 'error' } as const
  const loading = { status: 'loading' } as const
  it.each<[string, Partial<ShelfMapSources>]>([
    ['관측 0건', { analysis: ready(analysisOf([1, counts(0)])) }],
    ['수신 대기', { analysis: ready(analysisOf([1, counts(0), 'WAITING'])) }],
    ['점검 대상 아님', { analysis: ready(analysisOf()) }],
    ['서가 목록 재조회 실패', { shelves: ready([shelf(1)], true) }],
    ['분석 재조회 실패', { analysis: ready(analysisOf([1, counts(3)]), true) }],
    ['분석 조회 실패', { analysis: failed }],
    ['소재불명 후보 미산출', { missing: NOT_PRODUCED }],
    ['소재불명 후보 조회 중', { missing: loading }],
    ['소재불명 후보 조회 실패', { missing: failed }],
    ['소재불명 후보 재조회 실패', { missing: ready(candidates(), true) }],
    ['폐기 후보 조회 실패', { disposal: failed }],
    ['평가 현황 조회 실패', { evaluation: failed }],
    ['가치평가 결과 없음', { evaluation: ready(summary(0)) }],
    ['전체 평가 불가', { evaluation: ready(summary(3, 3)) }],
    ['일부 평가 불가', { evaluation: ready(summary(3, 1)) }],
    ['오배치', { analysis: ready(analysisOf([1, counts(2, 1)])) }],
    ['검토 필요', { analysis: ready(analysisOf([1, counts(2, 0, 1)])) }],
    ['소재불명 후보 있음(종결 포함)', { missing: ready(candidates([1, 'RESOLVED'])) }],
    ['폐기 검토 후보 있음', { disposal: ready(byShelf([1, 1])) }],
  ])('%s이면 표시하지 않는다', (_label, overrides) => {
    expect(mapOf(clean(overrides)).entry(1).markers).not.toContain('normal')
  })
})

describe('분류별 독립 집계', () => {
  const sources = (overrides: Partial<ShelfMapSources> = {}) =>
    clean({
      analysis: ready(analysisOf([1, counts(1, 1, 1)])),
      missing: ready(candidates([1], [1, 'FOUND'], [1, 'RESOLVED'], [1, 'LOST_CANDIDATE'])),
      disposal: ready(byShelf([1, 2])),
      ...overrides,
    })

  it('여러 분류를 함께 표시하고, 찾음·종결 후보를 따로 센다', () => {
    const entry = mapOf(sources()).entry(1)
    expect(entry.markers).toEqual(['misplaced', 'reviewRequired', 'missing', 'disposal'])
    expect([entry.missing, entry.disposal]).toEqual([{ total: 4, closed: 2 }, 2])
  })

  it.each<[keyof ShelfMapSources, string[]]>([
    ['analysis', ['missing', 'disposal']],
    ['missing', ['misplaced', 'reviewRequired', 'disposal']],
    ['disposal', ['misplaced', 'reviewRequired', 'missing']],
    ['evaluation', ['misplaced', 'reviewRequired', 'missing', 'disposal']],
  ])('%s 조회에 실패해도 다른 분류는 표시한다', (failing, markers) => {
    expect(mapOf(sources({ [failing]: { status: 'error' } })).entry(1).markers).toEqual(markers)
  })

  it('폐기 검토 후보는 대상이 아닌 서가와 관측 0건 서가에도 표시한다', () => {
    const model = mapOf(
      clean({
        shelves: ready([shelf(1), shelf(2), shelf(3, { active: false })]),
        analysis: ready(analysisOf([1, counts(0)])),
        disposal: ready(byShelf([1, 1], [2, 2], [3, 3])),
      }),
    )
    expect(model.entries.map((e) => [e.shelfId, e.inspection, e.disposal, e.markers])).toEqual([
      [1, 'noObservation', 1, ['disposal']],
      [2, 'notTargeted', 2, ['disposal']],
      [3, 'notTargeted', 3, ['disposal']],
    ])
  })

  it('알 수 없는 후보 수는 0이 아니라 null이다', () => {
    const review = mapOf(clean({ missing: NOT_PRODUCED, disposal: NOT_PRODUCED, evaluation: NOT_PRODUCED }))
    expect([review.entry(1).missing, review.entry(1).disposal, review.evaluation]).toEqual([null, null, 'notProduced'])
    expect(review.offMap).toEqual({ missing: null, disposal: null })

    for (const [evaluation, state] of [
      [summary(0), 'none'],
      [summary(3, 3), 'allNotEvaluable'],
    ] as const) {
      const model = mapOf(clean({ evaluation: ready(evaluation) }))
      expect([model.evaluation, model.entry(1).disposal]).toEqual([state, null])
    }
    expect(mapOf(clean({ evaluation: ready(summary(3, 1)) })).entry(1).disposal).toBe(0)
  })
})

describe('지도에 담는 서가', () => {
  it('좌표가 모두 있는 서가만 지도에 놓고, 서가 조회에 없는 대상 서가도 빠뜨리지 않는다', () => {
    const model = mapOf(
      clean({
        shelves: ready([shelf(1), shelf(2, { mapX: null }), shelf(3, { mapY: null }), shelf(4, { mapX: 0, mapY: 0 })]),
        analysis: ready(analysisOf([1, counts(1)], [9, counts(0, 1)])),
      }),
    )
    expect(model.entries.map((e) => [e.shelfId, e.placed])).toEqual([
      [1, true],
      [2, false],
      [3, false],
      [4, true],
      [9, false],
    ])
    expect(model.entry(9)).toMatchObject({ shelf: null, shelfCode: 'S-9', markers: ['misplaced'] })
  })

  it('사용하지 않는 서가는 점검 대상이거나 후보가 있을 때만 담는다', () => {
    const inactive = (id: number) => shelf(id, { active: false })
    const model = mapOf(
      clean({
        shelves: ready([inactive(1), inactive(2), inactive(3), inactive(4)]),
        analysis: ready(analysisOf([1, counts(1)])),
        missing: ready(candidates([2])),
        disposal: ready(byShelf([3, 1])),
      }),
    )
    expect(model.entries.map((e) => e.shelfId)).toEqual([1, 2, 3])
  })

  it('어느 서가에도 담지 못한 후보를 다른 서가와 서가 미지정으로 센다', () => {
    const model = mapOf(
      clean({ missing: ready(candidates([1], [50], [null])), disposal: ready(byShelf([1, 1], [50, 2], [null, 4])) }),
    )
    expect(model.offMap).toEqual({
      missing: { outside: 1, unassigned: 1 },
      disposal: { outside: 2, unassigned: 4 },
    })
  })

  it('기준 회차가 없으면 서가만 담는다', () => {
    const none = NOT_PRODUCED
    const model = mapOf({ shelves: ready([shelf(1)]), analysis: none, missing: none, disposal: none, evaluation: none })
    expect(model.entry(1)).toMatchObject({ inspection: 'noSession', analysis: null, markers: [] })
  })
})

describe('조회 상태', () => {
  const notFound = new ApiError(404, { code: ERROR_CODE.SCAN_SESSION_NOT_FOUND, message: '', errors: [] })

  it('회차가 없으면 캐시가 있어도 배치도 전체가 무효다', () => {
    const source = toSource({ data: summary(3), isError: true, error: notFound })
    expect(source).toEqual({ status: 'sessionMissing' })
    const model = buildShelfMapModel(clean({ evaluation: source as Source<EvaluationSummary> }))
    expect(model).toEqual({ kind: 'sessionMissing' })
  })

  it('받은 값이 있으면 재조회에 실패해도 유지하고 오래된 값으로 표시한다', () => {
    const error = new Error('실패')
    expect(toSource({ data: 1, isError: true, error })).toEqual({ status: 'ready', data: 1, stale: true })
    expect(toSource({ data: undefined, isError: true, error })).toEqual({ status: 'error' })
    expect(toSource({ data: undefined, isError: false, error: null })).toEqual({ status: 'loading' })
  })
})

describe('서가 목록 재조회 실패', () => {
  it('배치와 다른 분류의 마커는 유지한다', () => {
    const model = mapOf(
      clean({
        shelves: ready([shelf(1)], true),
        analysis: ready(analysisOf([1, counts(1, 1, 1)])),
        missing: ready(candidates([1])),
        disposal: ready(byShelf([1, 2])),
      }),
    )
    expect(model.entry(1)).toMatchObject({
      placed: true,
      inspection: 'observed',
      missing: { total: 1, closed: 0 },
      disposal: 2,
      markers: ['misplaced', 'reviewRequired', 'missing', 'disposal'],
    })
  })

  it('받아 둔 서가로 정상 마커만 숨기고, 재조회에 성공하면 다시 표시한다', async () => {
    let failing = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const observer = new QueryObserver(client, {
      queryKey: ['shelves'],
      queryFn: () => {
        if (failing) throw new Error('실패')
        return [shelf(1)]
      },
    })
    const unsubscribe = observer.subscribe(() => {})
    const entryNow = () => {
      const shelves = toSource(observer.getCurrentResult())
      if (shelves.status !== 'ready') throw new Error('서가를 받은 상태가 필요합니다')
      return mapOf(clean({ shelves })).entry(1)
    }

    await observer.refetch()
    expect(entryNow().markers).toEqual(['normal'])

    failing = true
    await observer.refetch()
    expect(observer.getCurrentResult().isRefetchError).toBe(true)
    expect(entryNow()).toMatchObject({ placed: true, inspection: 'observed', markers: [] })

    failing = false
    await observer.refetch()
    expect(entryNow().markers).toEqual(['normal'])

    unsubscribe()
    client.clear()
  })
})

describe('시드 데이터와의 정합성', () => {
  const { COMPLETED_LATEST, REVIEW_PARTIAL, REVIEW_COMPLETE } = SEED_SESSION_IDS

  function modelOf(sessionId: number, store = createScanStore(createSeedData())) {
    const session = store.getSession(sessionId)
    const analysis = store.getAnalysis(sessionId)
    const completed = session.status === 'COMPLETED'
    const missing = completed ? store.getMissingCandidates(sessionId, { size: 100 }) : undefined
    const disposal = completed ? store.getDisposalCandidatesByShelf(sessionId) : undefined
    const model = mapOf({
      shelves: ready(store.getShelves({ zone: session.zone!, includeInactive: true })),
      analysis: ready(analysis),
      missing: missing ? ready(missing.content) : NOT_PRODUCED,
      disposal: disposal ? ready(disposal) : NOT_PRODUCED,
      evaluation: completed ? ready(store.getDisposalCandidates(sessionId).summary) : NOT_PRODUCED,
    })
    return { model, analysis, missing, disposal }
  }

  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

  it.each([COMPLETED_LATEST, 6, 7, 100, 121])('회차 %i의 서가별 합계는 조회 응답의 전체 값과 같다', (sessionId) => {
    const { model, analysis, missing, disposal } = modelOf(sessionId)
    const { entries, offMap } = model

    for (const key of ['total', 'normal', 'misplaced', 'reviewRequired'] as const) {
      expect(sum(entries.map((e) => e.analysis?.[key] ?? 0))).toBe(analysis.counts[key])
    }
    expect(sum(entries.map((e) => e.missing!.total)) + offMap.missing!.outside + offMap.missing!.unassigned).toBe(
      missing!.totalElements,
    )
    expect(sum(entries.map((e) => e.disposal ?? 0)) + offMap.disposal!.outside + offMap.disposal!.unassigned).toBe(
      disposal!.totalCandidates,
    )
  })

  it('위치를 등록하지 않은 대상 서가는 결과를 유지한 채 지도에서 제외한다', () => {
    const entry = modelOf(REVIEW_PARTIAL).model.entries.find((e) => e.shelfCode === 'B-04')!
    expect(entry).toMatchObject({ placed: false, inspection: 'observed', missing: null, disposal: null })
    expect(entry.analysis?.total).toBeGreaterThan(0)
  })

  it('회차를 확정하면 소재불명 후보가 예상 서가에 나타난다', () => {
    const store = createScanStore(createSeedData(), { now: () => Date.parse('2026-11-26T03:00:00Z') })
    expect(modelOf(REVIEW_COMPLETE, store).model.entries.every((e) => e.missing === null)).toBe(true)
    store.finalizeSession(REVIEW_COMPLETE)
    const { model } = modelOf(REVIEW_COMPLETE, store)
    expect(sum(model.entries.map((e) => e.missing!.total))).toBe(21)
    expect(model.evaluation).toBe('none')
  })
})
