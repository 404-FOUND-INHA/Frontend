import { queryOptions, useQuery } from '@tanstack/react-query'
import { getScanSessions } from '@/api/scanSessions'
import type { ScanSessionResponse } from '@/types/scan/api'
import { timeKey } from '@/utils/localDateTime'
import { fetchAllPages, MAX_PAGE_SIZE } from './fetchAllPages'
import { scanKeys } from './queryKeys'

/**
 * 확정 시각이 가장 늦은 회차. zone을 주면 그 자료실의 회차만 본다. 없으면 null.
 * 확정 시각은 소수 초 표기가 다를 수 있어 timeKey로 정밀도를 맞춰 비교한다. 같으면 ID가 큰 회차다.
 */
export function latestFinalizedSession(
  sessions: readonly ScanSessionResponse[],
  zone?: string,
): ScanSessionResponse | null {
  let latest: ScanSessionResponse | null = null
  let latestKey = ''
  for (const session of sessions) {
    if (session.status !== 'COMPLETED' || (zone !== undefined && session.zone !== zone)) continue
    // 확정 시각이 없거나 읽을 수 없으면 가장 이른 것으로 본다.
    const key = timeKey(session.finalizedAt ?? '') ?? ''
    if (!latest || key > latestKey || (key === latestKey && session.id > latest.id)) {
      latest = session
      latestKey = key
    }
  }
  return latest
}

/**
 * 확정한 회차 전체. 자료실 필터나 확정일 정렬이 API에 없어(목록은 생성일 순) 모든 페이지를 받아 화면에서 고른다.
 * 모든 자료실이 이 조회 하나를 함께 쓴다.
 */
export const completedSessionsQueryOptions = () =>
  queryOptions({
    queryKey: scanKeys.completedSessions(),
    queryFn: async () =>
      (await fetchAllPages((page) => getScanSessions({ status: ['COMPLETED'], page, size: MAX_PAGE_SIZE }))).content,
  })

/**
 * 자료실의 최근 확정 회차. zone을 생략하면 모든 자료실에서 가장 최근에 확정한 회차다.
 * data가 null이면 확정한 회차가 없고, undefined이면 아직 받지 못했다.
 */
export function useLatestCompletedSession(zone?: string) {
  return useQuery({
    ...completedSessionsQueryOptions(),
    select: (sessions) => latestFinalizedSession(sessions, zone),
  })
}
