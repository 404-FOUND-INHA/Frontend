import { queryOptions, useQuery } from '@tanstack/react-query'
import { getDisposalCandidatesByShelf } from '@/api/scanResults'
import { isRequestableId, scanKeys } from './queryKeys'

export const disposalCandidatesByShelfQueryOptions = (sessionId: number) =>
  queryOptions({
    queryKey: scanKeys.disposalCandidatesByShelf(sessionId),
    queryFn: () => getDisposalCandidatesByShelf(sessionId),
    enabled: isRequestableId(sessionId),
  })

/**
 * 회차의 폐기 검토 후보를 현재 서가로 묶은 결과. 평가 현황(summary)은 useDisposalCandidates로 확인한다.
 * 조회하지 않아야 하면 NaN을 넘긴다.
 */
export function useDisposalCandidatesByShelf(sessionId: number) {
  return useQuery(disposalCandidatesByShelfQueryOptions(sessionId))
}
