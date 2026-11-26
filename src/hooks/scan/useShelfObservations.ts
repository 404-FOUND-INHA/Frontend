import { queryOptions, useQuery } from '@tanstack/react-query'
import { getShelfObservations } from '@/api/scanAnalysis'
import { isRequestableId, scanKeys } from './queryKeys'

export const shelfObservationsQueryOptions = (sessionId: number, shelfId: number) =>
  queryOptions({
    queryKey: scanKeys.shelfObservations(sessionId, shelfId),
    queryFn: () => getShelfObservations(sessionId, shelfId),
    enabled: isRequestableId(sessionId) && isRequestableId(shelfId),
  })

/** 회차 대상 서가 하나의 관측 목록 */
export function useShelfObservations(sessionId: number, shelfId: number) {
  return useQuery(shelfObservationsQueryOptions(sessionId, shelfId))
}
