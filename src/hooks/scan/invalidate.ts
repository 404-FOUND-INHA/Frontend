import type { QueryClient } from '@tanstack/react-query'
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
