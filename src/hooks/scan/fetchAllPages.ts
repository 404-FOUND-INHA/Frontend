import type { PageResponse } from '@/types/scan/api'

/** 서버가 허용하는 가장 큰 페이지 크기 */
export const MAX_PAGE_SIZE = 100

/** 첫 페이지부터 마지막 페이지까지 차례로 가져온다. 한 페이지라도 실패하면 전체가 실패한다. */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<PageResponse<T>>,
): Promise<{ content: T[]; totalElements: number }> {
  const first = await fetchPage(0)
  const content = [...first.content]
  for (let page = 1; page < first.totalPages; page++) content.push(...(await fetchPage(page)).content)
  return { content, totalElements: first.totalElements }
}
