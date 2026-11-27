import { queryOptions, useQuery } from '@tanstack/react-query'
import { getScanReviews } from '@/api/scanReviews'
import type { ReviewListParams } from '@/types/scan/review'
import { isRequestableId, scanKeys } from './queryKeys'

export const scanReviewsQueryOptions = (sessionId: number, params?: ReviewListParams) => {
  // 조회 조건은 여기서 한 번만 확정하고 요청도 키에서 읽는다. 호출자가 이후 params를 바꿔도 키와 요청이 어긋나지 않는다.
  const queryKey = scanKeys.reviews(sessionId, params)
  const { shelfId } = queryKey[3]
  return queryOptions({
    queryKey,
    queryFn: ({ queryKey: [, , id, filter] }) => getScanReviews(id, filter),
    // 서가 필터는 생략할 수 있지만, 지정했다면 요청할 수 있는 ID여야 한다.
    enabled: isRequestableId(sessionId) && (shelfId === undefined || isRequestableId(shelfId)),
  })
}

/** 회차의 검토 대상 목록 한 페이지와 회차 전체의 검토 진행 현황 */
export function useScanReviews(sessionId: number, params?: ReviewListParams) {
  return useQuery(scanReviewsQueryOptions(sessionId, params))
}
