import { mutationOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { finalizeScanSession } from '@/api/scanSessions'
import { invalidateAfterFinalize, invalidateAfterFinalizeError } from './invalidate'
import { scanKeys } from './queryKeys'

// 캐시 갱신의 실패는 확정의 성패와 다르다. 갱신 오류가 성공한 확정을 실패로 바꾸거나 확정 오류를 가리지 않게 한다.
const ignoreRefreshFailure = () => {}

export const finalizeScanSessionMutationOptions = (queryClient: QueryClient, sessionId: number) =>
  mutationOptions({
    // 화면을 다시 열어도 진행 중인 확정을 알 수 있도록 회차별 키를 둔다.
    mutationKey: scanKeys.finalize(sessionId),
    mutationFn: () => finalizeScanSession(sessionId),
    // 갱신이 끝날 때까지 mutation을 pending으로 유지한다.
    onSuccess: (response) => invalidateAfterFinalize(queryClient, response).catch(ignoreRefreshFailure),
    onError: (error) => invalidateAfterFinalizeError(queryClient, sessionId, error).catch(ignoreRefreshFailure),
  })

/** 검토를 마친 회차의 확정. 중복 요청을 막는 화면 제어는 호출하는 쪽이 맡는다. */
export function useFinalizeScanSession(sessionId: number) {
  const queryClient = useQueryClient()
  return useMutation(finalizeScanSessionMutationOptions(queryClient, sessionId))
}
