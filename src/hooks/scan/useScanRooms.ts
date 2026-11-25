import { queryOptions, useQuery } from '@tanstack/react-query'
import { getScanRooms } from '@/api/scanSessions'
import { scanKeys } from './queryKeys'

export const scanRoomsQueryOptions = () =>
  queryOptions({
    queryKey: scanKeys.rooms(),
    queryFn: getScanRooms,
  })

export function useScanRooms() {
  return useQuery(scanRoomsQueryOptions())
}
