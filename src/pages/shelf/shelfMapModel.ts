import { ERROR_CODE, isApiError } from '@/api/ApiError'
import { getEvaluationOutcome } from '@/pages/scan/scanResultsView'
import type { AnalysisCounts, ScanAnalysisResponse } from '@/types/scan/analysis'
import type { EvaluationSummary, ShelfCandidatesResponse } from '@/types/scan/evaluation'
import type { MissingCandidateResponse } from '@/types/scan/missingCandidate'
import type { ShelfResponse } from '@/types/scan/shelf'

// 서가 배치도의 서가별 표시 모델(순수 함수). 자동 분석 결과, 소재불명 후보, 폐기 검토 후보는 서로 다른 기준의
// 분류라 따로 판단하고, 한 분류를 알 수 없어도 나머지는 표시한다. 좌표의 해석은 여기서 하지 않는다.
//   - 자동 분석: 그 회차에서 관측한 서가
//   - 소재불명 후보: 후보를 만든 시점의 예상 서가
//   - 폐기 검토 후보: 조회 시점의 도서 원장의 현재 서가 (대상 서가가 아니거나 관측이 0건이어도 있을 수 있다)

/** 조회 한 건의 상태. stale은 재조회에 실패해 받아 둔 값을 보여 주는 경우다. */
export type Source<T> =
  | { status: 'ready'; data: T; stale: boolean }
  | { status: 'loading' | 'error' | 'sessionMissing' }
  /** 조회 대상이 아니다: 확정 전 회차의 후보, 점검 이력이 없는 자료실 */
  | { status: 'notProduced' }

/** 값을 받아 둔 조회 */
export type ReadySource<T> = Extract<Source<T>, { status: 'ready' }>

export const NOT_PRODUCED = { status: 'notProduced' } as const

/** TanStack Query 결과를 모델의 입력으로 바꾼다. 조회하지 않는 분류는 이 함수 대신 NOT_PRODUCED를 쓴다. */
export function toSource<T>(query: { data: T | undefined; isError: boolean; error: unknown }): Source<T> {
  // 회차가 없다는 명시적인 응답은 캐시가 있어도 이전 결과를 보여 주지 않는다.
  const { error } = query
  if (query.isError && isApiError(error) && error.status === 404 && error.code === ERROR_CODE.SCAN_SESSION_NOT_FOUND) {
    return { status: 'sessionMissing' }
  }
  if (query.data !== undefined) return { status: 'ready', data: query.data, stale: query.isError }
  return { status: query.isError ? 'error' : 'loading' }
}

export interface ShelfMapSources {
  /** zone의 서가(비활성 포함). 최초 조회의 로딩과 실패는 화면이 처리하고, 서가를 받은 뒤의 상태를 넘긴다. */
  shelves: ReadySource<readonly ShelfResponse[]>
  analysis: Source<ScanAnalysisResponse>
  missing: Source<readonly MissingCandidateResponse[]>
  disposal: Source<ShelfCandidatesResponse>
  /** 회차 전체의 평가 현황 */
  evaluation: Source<EvaluationSummary>
}

/**
 * notTargeted: 회차의 점검 대상이 아니다. waiting: 결과 수신 대기. noObservation: 수신했고 관측 0건.
 * observed: 관측 있음. unknown: 분석 결과를 몰라 대상인지 알 수 없다. noSession: 기준 회차가 없다.
 */
export type ShelfInspection = 'notTargeted' | 'waiting' | 'noObservation' | 'observed' | 'unknown' | 'noSession'

export type ShelfMarker = 'normal' | 'misplaced' | 'reviewRequired' | 'missing' | 'disposal'

export interface ShelfMapEntry {
  shelfId: number
  shelfCode: string
  /** 서가 조회 결과. 점검 대상이지만 이 자료실의 서가 조회에 없으면 null */
  shelf: ShelfResponse | null
  /** 지도 좌표가 모두 있는가. false인 서가는 지도에 놓지 않는다. */
  placed: boolean
  inspection: ShelfInspection
  /** 이 서가에서 관측한 건수. 대상 서가가 아니거나 수신 전이거나 분석 결과를 모르면 null */
  analysis: AnalysisCounts | null
  /** 이 서가가 예상 서가인 소재불명 후보. closed는 그중 찾음·종결. 알 수 없으면 null (0건과 다르다) */
  missing: { total: number; closed: number } | null
  /** 이 서가가 현재 서가인 폐기 검토 후보 수. 알 수 없으면 null (0건과 다르다) */
  disposal: number | null
  markers: ShelfMarker[]
}

/**
 * 회차의 가치평가 상태. none: 저장된 평가가 없다. partial: 일부 도서가 평가 불가. complete: 평가 불가 없음.
 */
export type ShelfMapEvaluation =
  | 'notProduced'
  | 'loading'
  | 'error'
  | 'none'
  | 'allNotEvaluable'
  | 'partial'
  | 'complete'

/** 이 배치도의 어느 서가에도 담지 못한 후보 수. outside: 다른 서가, unassigned: 서가 미지정 */
export interface OffMapCandidates {
  outside: number
  unassigned: number
}

export type ShelfMapModel =
  /** 회차가 없다. 아무것도 보여 주지 않는다. */
  | { kind: 'sessionMissing' }
  | {
      kind: 'map'
      entries: ShelfMapEntry[]
      evaluation: ShelfMapEvaluation
      /** 알 수 없으면 null */
      offMap: { missing: OffMapCandidates | null; disposal: OffMapCandidates | null }
    }

const CLOSED_STATUSES = new Set(['FOUND', 'RESOLVED'])

function evaluationOf(source: Source<EvaluationSummary>): ShelfMapEvaluation {
  if (source.status !== 'ready') return source.status === 'sessionMissing' ? 'error' : source.status
  const outcome = getEvaluationOutcome(source.data)
  if (outcome === 'none' || outcome === 'allNotEvaluable') return outcome
  return source.data.notEvaluable > 0 ? 'partial' : 'complete'
}

/** 서가별 후보 수. 서가가 없는 후보는 null에 모은다. */
function countByShelf<T>(items: readonly T[], shelfIdOf: (item: T) => number | null, countOf: (item: T) => number) {
  const counts = new Map<number | null, number>()
  for (const item of items) {
    const id = shelfIdOf(item)
    counts.set(id, (counts.get(id) ?? 0) + countOf(item))
  }
  return counts
}

function offMapOf(counts: Map<number | null, number>, shown: Set<number>): OffMapCandidates {
  let outside = 0
  for (const [shelfId, count] of counts) if (shelfId !== null && !shown.has(shelfId)) outside += count
  return { outside, unassigned: counts.get(null) ?? 0 }
}

export function buildShelfMapModel(sources: ShelfMapSources): ShelfMapModel {
  const { shelves, analysis, missing, disposal, evaluation } = sources
  if ([analysis, missing, disposal, evaluation].some((source) => source.status === 'sessionMissing')) {
    return { kind: 'sessionMissing' }
  }

  const targets = new Map(analysis.status === 'ready' ? analysis.data.shelves.map((s) => [s.shelfId, s]) : [])
  const missingCounts =
    missing.status === 'ready' ? countByShelf(missing.data, (c) => c.expectedShelfId, () => 1) : null
  const closedCounts =
    missing.status === 'ready'
      ? countByShelf(missing.data, (c) => c.expectedShelfId, (c) => (CLOSED_STATUSES.has(c.status) ? 1 : 0))
      : null
  const disposalCounts =
    disposal.status === 'ready'
      ? countByShelf(disposal.data.shelves, (g) => g.shelf?.shelfId ?? null, (g) => g.candidateCount)
      : null
  const evaluationState = evaluationOf(evaluation)
  // 평가 결과가 없거나 모두 평가 불가이면 후보가 없는 서가를 "0권"이라 할 수 없다.
  const disposalUnjudged = evaluationState === 'none' || evaluationState === 'allNotEvaluable'

  const inspectionOf = (shelfId: number): ShelfInspection => {
    if (analysis.status === 'notProduced') return 'noSession'
    if (analysis.status !== 'ready') return 'unknown'
    const target = targets.get(shelfId)
    if (!target) return 'notTargeted'
    if (target.scanStatus === 'WAITING') return 'waiting'
    return target.counts.total === 0 ? 'noObservation' : 'observed'
  }

  const entryOf = (shelfId: number, shelfCode: string, shelf: ShelfResponse | null): ShelfMapEntry => {
    const inspection = inspectionOf(shelfId)
    const received = inspection === 'observed' || inspection === 'noObservation'
    const counts = received ? (targets.get(shelfId)?.counts ?? null) : null
    const missingCount = missingCounts && {
      total: missingCounts.get(shelfId) ?? 0,
      closed: closedCounts?.get(shelfId) ?? 0,
    }
    const found = disposalCounts?.get(shelfId) ?? 0
    const disposalCount = disposalCounts === null || (found === 0 && disposalUnjudged) ? null : found

    const markers: ShelfMarker[] = []
    if (counts && counts.misplaced > 0) markers.push('misplaced')
    if (counts && counts.reviewRequired > 0) markers.push('reviewRequired')
    if (missingCount && missingCount.total > 0) markers.push('missing')
    if (disposalCount !== null && disposalCount > 0) markers.push('disposal')
    // 정상은 서가 목록과 모든 분류를 최신 조회로 확인했을 때만 표시한다. 평가 불가인 도서가 하나라도 있으면 표시하지 않는다.
    const confirmed = [shelves, analysis, missing, disposal, evaluation].every((s) => s.status === 'ready' && !s.stale)
    if (
      confirmed &&
      evaluationState === 'complete' &&
      inspection === 'observed' &&
      counts !== null &&
      counts.normal === counts.total &&
      missingCount?.total === 0 &&
      disposalCount === 0
    ) {
      markers.push('normal')
    }

    return {
      shelfId,
      shelfCode,
      shelf,
      placed: shelf !== null && shelf.mapX !== null && shelf.mapY !== null,
      inspection,
      analysis: counts,
      missing: missingCount,
      disposal: disposalCount,
      markers,
    }
  }

  // 사용 중 서가, 점검 대상 서가, 후보가 있는 서가를 담는다. 그 밖의 사용하지 않는 서가는 담지 않는다.
  const listed = shelves.data.filter(
    (shelf) => shelf.active || targets.has(shelf.id) || missingCounts?.has(shelf.id) || disposalCounts?.has(shelf.id),
  )
  const listedIds = new Set(listed.map((shelf) => shelf.id))
  const entries = [
    ...listed.map((shelf) => entryOf(shelf.id, shelf.shelfCode, shelf)),
    ...[...targets.values()]
      .filter((target) => !listedIds.has(target.shelfId))
      .map((target) => entryOf(target.shelfId, target.shelfCode, null)),
  ]
  const shown = new Set(entries.map((entry) => entry.shelfId))

  return {
    kind: 'map',
    entries,
    evaluation: evaluationState,
    offMap: {
      missing: missingCounts && offMapOf(missingCounts, shown),
      disposal: disposalCounts && offMapOf(disposalCounts, shown),
    },
  }
}
