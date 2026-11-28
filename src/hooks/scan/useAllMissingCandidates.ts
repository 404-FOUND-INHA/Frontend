import { queryOptions, useQuery } from '@tanstack/react-query'
import { getMissingCandidates } from '@/api/scanResults'
import type { MissingCandidateResponse } from '@/types/scan/missingCandidate'
import { fetchAllPages, MAX_PAGE_SIZE } from './fetchAllPages'
import { isRequestableId, scanKeys } from './queryKeys'
import { uniqueBy } from './uniqueBy'

/**
 * 회차의 소재불명 후보 전체. API에 서가 필터가 없어 서가별로 세려면 모든 페이지가 필요하다.
 * 후보의 구성과 순서는 확정 뒤에 바뀌지 않는다. 모은 수가 전체 건수와 다르면 일부만 센 결과를 쓰지 않고 실패시킨다.
 */
async function fetchAllMissingCandidates(sessionId: number): Promise<MissingCandidateResponse[]> {
  const { content, totalElements } = await fetchAllPages((page) =>
    getMissingCandidates(sessionId, { page, size: MAX_PAGE_SIZE }),
  )
  const candidates = uniqueBy(content, (candidate) => candidate.candidateId)
  if (candidates.length !== totalElements) throw new Error('소재불명 후보를 빠짐없이 가져오지 못했습니다')
  return candidates
}

export const allMissingCandidatesQueryOptions = (sessionId: number) =>
  queryOptions({
    queryKey: scanKeys.allMissingCandidates(sessionId),
    queryFn: () => fetchAllMissingCandidates(sessionId),
    enabled: isRequestableId(sessionId),
  })

/** 확정하지 않은 회차처럼 조회하지 않아야 하면 NaN을 넘긴다. */
export function useAllMissingCandidates(sessionId: number) {
  return useQuery(allMissingCandidatesQueryOptions(sessionId))
}
