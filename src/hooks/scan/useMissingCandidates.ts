import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query'
import { getMissingCandidates } from '@/api/scanResults'
import type { MissingCandidateListParams } from '@/types/scan/missingCandidate'
import { isRequestableId, scanKeys } from './queryKeys'
import { uniqueBy } from './uniqueBy'
import { getNextScanSessionsPage, loadMoreScanSessions } from './useScanSessions'

export const missingCandidatesInfiniteQueryOptions = (
  sessionId: number,
  params?: Omit<MissingCandidateListParams, 'page'>,
) => {
  // 조회 조건은 여기서 한 번만 확정하고 요청도 키에서 읽는다.
  const queryKey = scanKeys.missingCandidates(sessionId, params)
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ queryKey: [, , id, filter], pageParam }) => getMissingCandidates(id, { ...filter, page: pageParam }),
    initialPageParam: 0,
    getNextPageParam: getNextScanSessionsPage,
    enabled: isRequestableId(sessionId),
    // 카드(전체 건수)와 목록이 같은 데이터를 쓴다. 페이지 사이에 목록이 달라져 겹친 항목은 한 번만 담는다.
    select: ({ pages }) => ({
      totalElements: pages[0].totalElements,
      candidates: uniqueBy(
        pages.flatMap((page) => page.content),
        (candidate) => candidate.candidateId,
      ),
    }),
  })
}

/** 회차의 소재불명 후보. data는 전체 건수와 지금까지 불러온 후보이고, 더보기는 loadMore를 사용한다. */
export function useMissingCandidates(sessionId: number, params?: Omit<MissingCandidateListParams, 'page'>) {
  const { fetchNextPage, ...query } = useInfiniteQuery(missingCandidatesInfiniteQueryOptions(sessionId, params))
  // 진행 중인 재조회를 취소하지 않는 더보기 (이유는 loadMoreScanSessions 참고)
  return { ...query, loadMore: () => loadMoreScanSessions(fetchNextPage) }
}
