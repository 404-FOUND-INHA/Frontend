import { queryOptions, useQuery } from '@tanstack/react-query'
import { getShelves } from '@/api/shelves'
import type { ShelfListParams } from '@/types/scan/shelf'
import { scanKeys } from './queryKeys'

export const shelvesQueryOptions = (params?: ShelfListParams) => {
  const queryKey = scanKeys.shelves(params)
  return queryOptions({
    queryKey,
    queryFn: ({ queryKey: [, , filter] }) => getShelves(filter),
  })
}

/** 서가 목록. enabled가 false이면 조회하지 않는다(자료실이 아직 정해지지 않은 경우). */
export function useShelves(params?: ShelfListParams, enabled: boolean = true) {
  return useQuery({ ...shelvesQueryOptions(params), enabled })
}
