import { mutationOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { updateEvaluationSettings } from '@/api/evaluationSettings'
import type { EvaluationSettingsUpdateRequest } from '@/types/evaluation/settings'
import { evaluationKeys } from './queryKeys'

export const updateEvaluationSettingsMutationOptions = (queryClient: QueryClient) =>
  mutationOptions({
    mutationKey: evaluationKeys.updateSettings(),
    mutationFn: (request: EvaluationSettingsUpdateRequest) => updateEvaluationSettings(request),
    // 응답이 곧 새 활성 설정이므로 다시 조회하지 않고 캐시를 바꾼다. 진행 중인 조회가 옛 값으로 덮어쓰지 않게 먼저 취소한다.
    onSuccess: async (response) => {
      await queryClient.cancelQueries({ queryKey: evaluationKeys.settings() })
      queryClient.setQueryData(evaluationKeys.settings(), response)
    },
  })

/** 평가 설정 저장. 중복 요청을 막는 화면 제어는 호출하는 쪽이 맡는다. */
export function useUpdateEvaluationSettings() {
  const queryClient = useQueryClient()
  return useMutation(updateEvaluationSettingsMutationOptions(queryClient))
}
