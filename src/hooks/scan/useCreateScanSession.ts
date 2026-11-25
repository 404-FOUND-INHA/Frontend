import { mutationOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createScanSession } from '@/api/scanSessions'
import { invalidateAfterCreate } from './invalidate'
import { scanKeys } from './queryKeys'

export const createScanSessionMutationOptions = (queryClient: QueryClient) =>
  mutationOptions({
    mutationFn: createScanSession,
    onSuccess: async (created) => {
      // 생성 응답은 상세 응답과 같은 형태라 상세 캐시로 바로 쓴다. (생성 직후 상세 화면 이동 시 재요청 불필요)
      queryClient.setQueryData(scanKeys.session(created.id), created)
      // 목록과 자료실 갱신이 끝날 때까지 mutation을 pending으로 유지한다.
      await invalidateAfterCreate(queryClient)
    },
    // 실패(409 등)한 경우에는 성공 처리를 하지 않으므로 캐시를 바꾸지 않는다.
  })

export function useCreateScanSession() {
  const queryClient = useQueryClient()
  return useMutation(createScanSessionMutationOptions(queryClient))
}
