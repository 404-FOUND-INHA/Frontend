import { queryOptions, useQuery } from '@tanstack/react-query'
import { getEvaluationSettings } from '@/api/evaluationSettings'
import { evaluationKeys } from './queryKeys'

export const evaluationSettingsQueryOptions = () =>
  queryOptions({
    queryKey: evaluationKeys.settings(),
    queryFn: getEvaluationSettings,
  })

/** 현재 활성 평가 설정(기준 점수, 평가축별 가중치) */
export function useEvaluationSettings() {
  return useQuery(evaluationSettingsQueryOptions())
}
