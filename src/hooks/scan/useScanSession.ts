import { queryOptions, useQuery } from '@tanstack/react-query'
import { getScanSession } from '@/api/scanSessions'
import { scanKeys } from './queryKeys'

export const scanSessionQueryOptions = (id: number) =>
  queryOptions({
    queryKey: scanKeys.session(id),
    queryFn: () => getScanSession(id),
  })

/** 라우트 파라미터가 정수가 아니면(NaN 등) 요청하지 않는다. */
export function useScanSession(id: number) {
  return useQuery({ ...scanSessionQueryOptions(id), enabled: Number.isInteger(id) })
}
