import { describe, expect, it, vi } from 'vitest'
import type { PageResponse } from '@/types/scan/api'
import { normalizeStatuses, scanKeys } from './queryKeys'
import {
  getNextScanSessionsPage,
  loadMoreScanSessions,
  scanSessionsInfiniteQueryOptions,
} from './useScanSessions'

function page(pageNumber: number, totalPages: number): PageResponse<unknown> {
  return { content: [], page: pageNumber, size: 20, totalElements: totalPages * 20, totalPages }
}

describe('쿼리 키 정규화', () => {
  it('상태 필터를 정렬하고 중복을 제거한다', () => {
    expect(normalizeStatuses(['REVIEW', 'IN_PROGRESS', 'REVIEW'])).toEqual(['IN_PROGRESS', 'REVIEW'])
  })

  it('필터가 없거나 비어 있으면 같은 "전체" 키가 된다', () => {
    expect(scanKeys.sessionList(undefined, 20)).toEqual(scanKeys.sessionList([], 20))
  })

  it('순서나 중복만 다른 필터는 같은 키를, 다른 필터나 페이지 크기는 다른 키를 만든다', () => {
    const a = scanSessionsInfiniteQueryOptions(['REVIEW', 'IN_PROGRESS']).queryKey
    const b = scanSessionsInfiniteQueryOptions(['IN_PROGRESS', 'REVIEW', 'REVIEW']).queryKey
    expect(a).toEqual(b)
    expect(scanSessionsInfiniteQueryOptions(['REVIEW']).queryKey).not.toEqual(a)
    expect(scanSessionsInfiniteQueryOptions(['REVIEW'], 5).queryKey).not.toEqual(scanSessionsInfiniteQueryOptions(['REVIEW'], 20).queryKey)
  })

  it('목록 접두사 키는 모든 필터·페이지 크기의 목록 키를 포함하고 자료실·상세 키는 포함하지 않는다', () => {
    const prefix = scanKeys.sessionLists()
    const startsWithPrefix = (key: readonly unknown[]) => prefix.every((part, i) => key[i] === part)
    expect(startsWithPrefix(scanKeys.sessionList(undefined, 20))).toBe(true)
    expect(startsWithPrefix(scanKeys.sessionList(['COMPLETED'], 5))).toBe(true)
    expect(startsWithPrefix(scanKeys.rooms())).toBe(false)
    expect(startsWithPrefix(scanKeys.session(1))).toBe(false)
  })

  it('기본 페이지 크기는 20이다', () => {
    expect(scanSessionsInfiniteQueryOptions().queryKey).toEqual(scanKeys.sessionList(undefined, 20))
  })
})

describe('더보기 호출', () => {
  it('진행 중인 재조회를 취소하지 않도록 cancelRefetch: false로 호출하고 그 결과를 그대로 돌려준다', async () => {
    const fetchNextPage = vi.fn().mockResolvedValue('result')
    await expect(loadMoreScanSessions(fetchNextPage)).resolves.toBe('result')
    expect(fetchNextPage).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false })
  })
})

describe('다음 페이지 계산', () => {
  it('마지막 페이지가 아니면 다음 페이지 번호를 돌려준다 (page는 0부터)', () => {
    expect(getNextScanSessionsPage(page(0, 3))).toBe(1)
    expect(getNextScanSessionsPage(page(1, 3))).toBe(2)
  })

  it('마지막 페이지, 결과 없음, 범위 밖 페이지는 undefined이다', () => {
    expect(getNextScanSessionsPage(page(2, 3))).toBeUndefined()
    expect(getNextScanSessionsPage(page(0, 1))).toBeUndefined()
    expect(getNextScanSessionsPage(page(0, 0))).toBeUndefined()
    expect(getNextScanSessionsPage(page(5, 2))).toBeUndefined()
  })

  it('목록 옵션이 같은 함수로 다음 페이지를 판단한다', () => {
    expect(scanSessionsInfiniteQueryOptions().getNextPageParam).toBe(getNextScanSessionsPage)
    expect(scanSessionsInfiniteQueryOptions().initialPageParam).toBe(0)
  })
})
