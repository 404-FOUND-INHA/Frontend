import {
  infiniteQueryOptions,
  useInfiniteQuery,
  type FetchNextPageOptions,
} from '@tanstack/react-query'
import { getScanSessions } from '@/api/scanSessions'
import type { PageResponse, ScanSessionStatus } from '@/types/scan/api'
import { scanKeys } from './queryKeys'

export const SCAN_SESSIONS_PAGE_SIZE = 20

/** 다음 페이지 번호. Backend 페이지 응답(page는 0부터, totalPages)으로 판단하고 마지막 페이지면 undefined */
export function getNextScanSessionsPage(lastPage: PageResponse<unknown>): number | undefined {
  return lastPage.page + 1 < lastPage.totalPages ? lastPage.page + 1 : undefined
}

export const scanSessionsInfiniteQueryOptions = (
  statuses?: readonly ScanSessionStatus[],
  size: number = SCAN_SESSIONS_PAGE_SIZE,
) => {
  // 조회 조건은 여기서 한 번만 확정한다(정렬·중복 제거된 복사본). 호출자가 이후 statuses 배열을 바꿔도 키가 달라지지 않는다.
  const queryKey = scanKeys.sessionList(statuses, size)
  return infiniteQueryOptions({
    queryKey,
    // 요청도 확정된 키에서 조회 조건을 읽는다. 원본 배열을 다시 읽지 않으므로 키와 요청 조건이 어긋날 수 없다.
    queryFn: ({ queryKey: [, , , filter], pageParam }) =>
      getScanSessions({ status: filter.status, page: pageParam, size: filter.size }),
    initialPageParam: 0,
    getNextPageParam: getNextScanSessionsPage,
  })
}

/**
 * 더보기. 진행 중인 재조회를 취소하지 않는다.
 * fetchNextPage의 기본 동작(cancelRefetch: true)은 진행 중인 재조회(예: 회차 생성 후 목록 갱신)를 취소하고 대체한다.
 * 그러면 갱신 이전의 첫 페이지와 갱신 이후의 다음 페이지가 한 캐시에 섞여 항목이 중복·누락된다.
 * cancelRefetch: false이면 진행 중인 재조회가 끝날 때까지 기다리고 그 결과를 돌려주며, 다음 페이지는 가져오지 않는다.
 * 이 경우 hasNextPage가 그대로 true이므로 재조회가 끝난 뒤 다시 호출하면 최신 데이터 위에서 다음 페이지를 불러온다.
 * 같은 이유로 연타해도 요청이 중복되지 않는다.
 */
export function loadMoreScanSessions(fetchNextPage: (options?: FetchNextPageOptions) => Promise<unknown>) {
  return fetchNextPage({ cancelRefetch: false })
}

/**
 * 상태 필터별 회차 목록(최신순). statuses가 없으면 전체.
 * 더보기는 반드시 loadMore를 사용한다. 안전하지 않은 기본 fetchNextPage는 노출하지 않는다.
 */
export function useScanSessions(statuses?: readonly ScanSessionStatus[], size?: number) {
  const { fetchNextPage, ...query } = useInfiniteQuery(scanSessionsInfiniteQueryOptions(statuses, size))
  return { ...query, loadMore: () => loadMoreScanSessions(fetchNextPage) }
}
