import { queryOptions, useQuery } from '@tanstack/react-query'
import { getObservationDetail } from '@/api/scanAnalysis'
import { isRequestableId, scanKeys } from './queryKeys'

export const observationDetailQueryOptions = (sessionId: number, observationId: number) =>
  queryOptions({
    queryKey: scanKeys.observation(sessionId, observationId),
    queryFn: () => getObservationDetail(sessionId, observationId),
    enabled: isRequestableId(sessionId) && isRequestableId(observationId),
  })

/** 관측 도서 하나의 상세(매칭 도서, 후보, 중복 관측) */
export function useObservationDetail(sessionId: number, observationId: number) {
  return useQuery(observationDetailQueryOptions(sessionId, observationId))
}
