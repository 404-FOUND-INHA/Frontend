import { queryOptions, useQuery } from '@tanstack/react-query'
import { getDisposalPreviewScores } from '@/api/evaluationSettings'
import { evaluationKeys } from './queryKeys'

export const disposalPreviewScoresQueryOptions = () =>
  queryOptions({
    queryKey: evaluationKeys.previewScores(),
    queryFn: getDisposalPreviewScores,
  })

/** 예상 영향 계산용 평가축 점수(Mock 전용). 계산은 화면에서 한다. */
export function useDisposalPreviewScores() {
  return useQuery(disposalPreviewScoresQueryOptions())
}
