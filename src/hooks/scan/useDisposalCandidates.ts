import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query'
import { getDisposalCandidates } from '@/api/scanResults'
import { isRequestableId, scanKeys } from './queryKeys'
import { uniqueBy } from './uniqueBy'
import { getNextScanSessionsPage, loadMoreScanSessions } from './useScanSessions'

export const disposalCandidatesInfiniteQueryOptions = (sessionId: number, size?: number) => {
  const queryKey = scanKeys.disposalCandidates(sessionId, size)
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ queryKey: [, , id, filter], pageParam }) =>
      getDisposalCandidates(id, { page: pageParam, size: filter.size }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => getNextScanSessionsPage(lastPage.page),
    enabled: isRequestableId(sessionId),
    // 카드(회차 전체의 평가 현황)와 목록이 같은 데이터를 쓴다.
    select: ({ pages }) => ({
      summary: pages[0].summary,
      candidates: uniqueBy(
        pages.flatMap((response) => response.page.content),
        (item) => item.evaluationId,
      ),
    }),
  })
}

/**
 * 회차의 평가 현황과 폐기 검토 후보. data.summary.total이 0이면 저장된 평가 결과가 없다.
 * 더보기는 loadMore를 사용한다.
 */
export function useDisposalCandidates(sessionId: number, size?: number) {
  const { fetchNextPage, ...query } = useInfiniteQuery(disposalCandidatesInfiniteQueryOptions(sessionId, size))
  return { ...query, loadMore: () => loadMoreScanSessions(fetchNextPage) }
}
