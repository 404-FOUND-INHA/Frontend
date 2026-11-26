import { queryOptions, useQuery } from '@tanstack/react-query'
import { getScanAnalysis } from '@/api/scanAnalysis'
import { isRequestableId, scanKeys } from './queryKeys'

export const scanAnalysisQueryOptions = (sessionId: number) =>
  queryOptions({
    queryKey: scanKeys.analysis(sessionId),
    queryFn: () => getScanAnalysis(sessionId),
    enabled: isRequestableId(sessionId),
  })

/** 회차의 자동 분석 요약과 서가별 현황 */
export function useScanAnalysis(sessionId: number) {
  return useQuery(scanAnalysisQueryOptions(sessionId))
}
