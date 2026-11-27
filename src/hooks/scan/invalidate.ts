import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import { ERROR_CODE, isApiError } from '@/api/ApiError'
import type { ScanSessionResponse } from '@/types/scan/api'
import type { FinalizeResponse } from '@/types/scan/review'
import { scanKeys } from './queryKeys'

/**
 * 회차 생성 후 갱신할 캐시: 모든 상태 필터·페이지 크기의 목록과 자료실 목록(hasOpenSession이 바뀐다).
 * 화면에 떠 있는(active) 쿼리는 즉시 다시 불러오고, 그렇지 않은 쿼리는 무효화 표시만 남아 다음에 쓸 때 새로 불러온다.
 * 다른 회차의 상세 캐시는 생성의 영향을 받지 않으므로 건드리지 않는다.
 *
 * 비활성(inactive) 쿼리는 무효화 전에 진행 중인 요청을 먼저 취소하고, 취소가 끝난 뒤에 무효화한다.
 * - 취소하지 않으면 생성 이전에 시작한 요청(예: 더보기)의 늦은 응답이 도착해 무효화 표시를 지우고(isInvalidated=false),
 *   생성 이전 첫 페이지와 생성 이후 다음 페이지가 한 캐시에 섞여 항목이 중복·누락된다.
 * - 취소는 요청 시작 시점의 상태로 되돌리므로(revert), 무효화를 먼저 하면 그 표시가 되돌려져 사라진다.
 *   그래서 취소를 먼저 호출한 다음 invalidateQueries를 호출한다. 현재 TanStack Query(5.107)는 되돌리기를 동기로
 *   처리하지만, 그 세부 동작에 기대지 않도록 cancelQueries가 끝나기를 기다린 뒤 무효화한다.
 *
 * 활성(active) 쿼리는 취소하지 않고 invalidateQueries에 맡긴다. 재조회가 진행 중인 요청을 조용히(silent) 교체하는데,
 * 이때 교체된 요청을 기다리던 쪽은 새 재조회가 끝나면 함께 완료된다.
 * 반대로 cancelQueries(revert)로 활성 쿼리의 재조회를 취소하면 그 재조회를 기다리던 앞선 mutation이
 * 복원된 이전 데이터와 함께 즉시 성공해 버린다. (생성 요청이 겹칠 때 첫 mutation이 캐시 갱신 전에 성공하는 문제)
 *
 * 취소된 요청의 늦은 응답은 TanStack Query가 무시한다. 캐시를 지우거나 staleTime을 바꾸지 않는다.
 */
export async function invalidateAfterCreate(queryClient: QueryClient): Promise<void> {
  const filters: { queryKey: readonly unknown[] }[] = [
    { queryKey: scanKeys.sessionLists() },
    { queryKey: scanKeys.rooms() },
  ]
  await Promise.all(filters.map((filter) => queryClient.cancelQueries({ ...filter, type: 'inactive' })))
  await Promise.all(filters.map((filter) => queryClient.invalidateQueries(filter)))
}

interface Target {
  queryKey: QueryKey
  exact?: boolean
}

const sessionTarget = (sessionId: number): Target => ({ queryKey: scanKeys.session(sessionId), exact: true })
const reviewsTarget = (sessionId: number): Target => ({ queryKey: scanKeys.sessionReviews(sessionId) })

/** 회차 확정으로 응답이 달라지는 조회 */
const finalizeTargets = (sessionId: number): Target[] => [
  { queryKey: scanKeys.sessionLists() }, // 상태, 확정일
  sessionTarget(sessionId),
  { queryKey: scanKeys.rooms() }, // hasOpenSession
  { queryKey: scanKeys.analysis(sessionId), exact: true }, // session.status
  reviewsTarget(sessionId),
  // 관측의 matchedBook은 도서의 현재 상태를 담으므로 다른 회차의 관측도 달라질 수 있다.
  { queryKey: scanKeys.allShelfObservations() },
  { queryKey: scanKeys.allObservations() },
]

const hasNoData = (query: Query) => query.state.data === undefined

/**
 * 비활성 쿼리 취소 → (선택) 캐시에 직접 반영 → 무효화. 활성 쿼리의 재조회가 끝나면 완료되고, 재조회 실패로는 거부되지 않는다.
 *
 * 비활성 쿼리를 먼저 취소하는 이유는 invalidateAfterCreate의 설명과 같다.
 * 활성 쿼리의 진행 중인 요청은 "조용한(silent) 취소 후 새 요청"으로 교체해야 한다. 교체된 요청을 기다리던
 * 앞선 mutation은 새 요청이 끝날 때까지 이어서 기다린다. 되돌리기(revert)로만 취소하면 그 대기가 바로 끝난다.
 * - 데이터가 있는 쿼리는 invalidateQueries가 이렇게 교체한다.
 * - 데이터가 없는 최초 요청은 invalidateQueries가 재사용하므로(갱신 이전의 늦은 응답이 캐시에 남는다) 직접 취소한다.
 *   취소와 invalidateQueries 사이에 await가 있으면 새 요청이 시작되기 전에 대기가 끝나므로 이어서 호출한다.
 */
async function refresh(queryClient: QueryClient, targets: Target[], write?: () => void): Promise<void> {
  await Promise.all(targets.map((target) => queryClient.cancelQueries({ ...target, type: 'inactive' })))
  write?.()
  await Promise.all(
    targets.map((target) => {
      void queryClient.cancelQueries({ ...target, type: 'active', predicate: hasNoData }, { silent: true })
      return queryClient.invalidateQueries(target)
    }),
  )
}

/**
 * 회차 확정 성공 후의 갱신. 캐시에 있는 회차 상세에는 확정 응답의 상태를 먼저 반영해,
 * 재조회가 실패해도 확정 전 상태(확정 가능)로 보이지 않게 한다. 캐시에 없는 상세는 만들지 않는다.
 */
export function invalidateAfterFinalize(queryClient: QueryClient, response: FinalizeResponse): Promise<void> {
  const { sessionId, status, finalizedAt } = response
  return refresh(queryClient, finalizeTargets(sessionId), () => {
    queryClient.setQueryData<ScanSessionResponse>(
      scanKeys.session(sessionId),
      (session) => session && { ...session, status, processingStage: 'ANALYSIS_DONE', finalizedAt },
    )
  })
}

/** 회차 확정 실패 후의 갱신. 오류가 알려 주는 범위만 다시 불러오고, 그 외의 오류에는 캐시를 바꾸지 않는다. */
export function invalidateAfterFinalizeError(queryClient: QueryClient, sessionId: number, error: unknown): Promise<void> {
  const code = isApiError(error) ? error.code : undefined
  // 이미 확정됐거나 상태가 달라졌다. 확정 시각은 응답에 없으므로 직접 쓰지 않고 다시 불러온다.
  if (code === ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE) return refresh(queryClient, finalizeTargets(sessionId))
  if (code === ERROR_CODE.SCAN_REVIEW_INCOMPLETE) return refresh(queryClient, [reviewsTarget(sessionId)])
  if (code === ERROR_CODE.SCAN_SESSION_NOT_FOUND) return refresh(queryClient, [sessionTarget(sessionId)])
  return Promise.resolve()
}
