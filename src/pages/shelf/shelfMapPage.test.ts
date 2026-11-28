import { InfiniteQueryObserver, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { allMissingCandidatesQueryOptions } from '@/hooks/scan/useAllMissingCandidates'
import { disposalCandidatesInfiniteQueryOptions } from '@/hooks/scan/useDisposalCandidates'
import { disposalCandidatesByShelfQueryOptions } from '@/hooks/scan/useDisposalCandidatesByShelf'
import { completedSessionsQueryOptions } from '@/hooks/scan/useLatestCompletedSession'
import { scanAnalysisQueryOptions } from '@/hooks/scan/useScanAnalysis'
import { scanRoomsQueryOptions } from '@/hooks/scan/useScanRooms'
import { scanSessionQueryOptions } from '@/hooks/scan/useScanSession'
import { loadMoreScanSessions } from '@/hooks/scan/useScanSessions'
import { shelvesQueryOptions } from '@/hooks/scan/useShelves'
import { SEED_ZONES, createSeedData } from '@/mocks/scan/seed'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import SessionShelfMapPage from './SessionShelfMapPage'
import ShelfMapPage from './ShelfMapPage'
import { shelfSummary, type ShelfMapStatus } from './shelfMapText'
import type { ShelfMapEntry } from './shelfMapModel'

// 배치도 화면을 정적 마크업으로 렌더링해 조회 상태에 따른 화면을 확인한다. 필요한 상태는 캐시에 먼저 만든다.
// 이동·확대·선택 같은 조작은 브라우저에서 확인한다.

let client: QueryClient

beforeEach(() => {
  resetScanStore({ now: () => Date.parse('2026-11-26T03:00:00Z') })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false, staleTime: 60_000 } },
  })
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

const render = (path: string, route: string, element: ReactNode) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: route, element })),
      ),
    ),
  )
const renderTab = (zone?: string) =>
  render(zone ? `/shelf?zone=${encodeURIComponent(zone)}` : '/shelf', '/shelf', createElement(ShelfMapPage))
const renderSession = (id: number) =>
  render(`/scan/${id}/shelf-map`, '/scan/:sessionId/shelf-map', createElement(SessionShelfMapPage))

/** 자료실의 서가와 한 회차의 조회 결과를 캐시에 만든다. */
async function loadMap(zone: string, sessionId?: number) {
  await client.fetchQuery(shelvesQueryOptions({ zone, includeInactive: true }))
  if (sessionId === undefined) return
  await client.fetchQuery(scanAnalysisQueryOptions(sessionId))
  if (getScanStore().getSession(sessionId).status !== 'COMPLETED') return
  await client.fetchQuery(allMissingCandidatesQueryOptions(sessionId))
  await client.fetchQuery(disposalCandidatesByShelfQueryOptions(sessionId))
  await client.fetchInfiniteQuery(disposalCandidatesInfiniteQueryOptions(sessionId))
}
async function loadTab(zone: string, sessionId?: number) {
  await client.fetchQuery(scanRoomsQueryOptions())
  await client.fetchQuery(completedSessionsQueryOptions())
  await loadMap(zone, sessionId)
}
async function loadSessionMap(id: number) {
  const session = await client.fetchQuery(scanSessionQueryOptions(id))
  await loadMap(session.zone!, id)
}

/** 상세 화면의 "더보기"처럼 캐시된 폐기 검토 후보의 다음 페이지를 요청해 실패시킨다. */
async function failNextDisposalPage(sessionId: number, error: Error) {
  const observer = new InfiniteQueryObserver(client, disposalCandidatesInfiniteQueryOptions(sessionId))
  const unsubscribe = observer.subscribe(() => {})
  vi.spyOn(getScanStore(), 'getDisposalCandidates').mockImplementation(() => {
    throw error
  })
  await loadMoreScanSessions((options) => observer.fetchNextPage(options))
  expect(observer.getCurrentResult().isFetchNextPageError).toBe(true)
  unsubscribe()
}

const textOf = (html: string) => html.replaceAll('<!-- -->', '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
/** 지도와 위치 미등록 목록의 서가: 서가 코드별 표시 */
const markersOf = (html: string) =>
  Object.fromEntries(
    [...html.matchAll(/<(?:g|button) [^>]*>/g)].flatMap(([tag]) => {
      const code = /aria-label="([A-Z]-\d\d) 서가/.exec(tag)
      const markers = /data-markers="([^"]*)"/.exec(tag)
      return code && markers ? [[code[1], markers[1]]] : []
    }),
  )

describe('서가 탭', () => {
  it('자료실을 지정하지 않으면 가장 최근에 확정한 회차의 자료실을 보여 준다', async () => {
    await loadTab(SEED_ZONES.HUMANITIES, 5)
    const html = renderTab()

    expect(html).toContain(`<option value="${SEED_ZONES.HUMANITIES}" selected="">`)
    expect(textOf(html)).toContain('최근 점검: 2026.06.20')
    // 회차명과 평가 설명은 쓰지 않고, 범례는 짧은 이름을 쓴다.
    expect(textOf(html)).not.toContain('정기 장서점검')
    expect(textOf(html)).not.toContain('가치평가')
    expect(textOf(html)).toContain('정상 오배치 소재불명 검토 필요 폐기 검토')
    // 평가 불가 도서가 있는 회차에는 정상 표시가 없다.
    expect(Object.values(markersOf(html)).join(' ')).not.toContain('normal')
    expect(Object.values(markersOf(html)).join(' ')).toContain('disposal')
  })

  it('없는 자료실 주소는 기본 자료실로 보여 준다', async () => {
    await loadTab(SEED_ZONES.HUMANITIES, 5)
    expect(renderTab('없는 자료실')).toContain(`<option value="${SEED_ZONES.HUMANITIES}" selected="">`)
  })

  it('평가 시드가 있는 이력 회차에서 정상·폐기·위치 미등록 서가를 구분한다', async () => {
    await loadTab(SEED_ZONES.SOCIAL, 120)
    const html = renderTab(SEED_ZONES.SOCIAL)

    expect(markersOf(html)).toEqual({ 'B-01': 'normal', 'B-02': 'disposal', 'B-03': 'normal', 'B-04': 'normal' })
    expect(html).toMatch(/aria-label="위치 미등록 서가"[\s\S]*B-04/)
  })

  it('점검 이력이 없는 자료실은 이력 없음을 알리고 표시를 하지 않는다', async () => {
    await loadTab(SEED_ZONES.MULTIMEDIA)
    const html = renderTab(SEED_ZONES.MULTIMEDIA)

    expect(textOf(html)).toContain('점검 이력이 없어 서가 배치만 표시합니다.')
    expect(textOf(html)).toContain('지도에 위치가 등록된 서가가 없습니다.')
    expect(markersOf(html)).toEqual({ 'F-01': '' })
  })

  it('최근 회차 조회에 실패하면 이력 없음이 아니라 실패로 알린다', async () => {
    vi.spyOn(getScanStore(), 'getSessions').mockImplementation(() => {
      throw new Error('실패')
    })
    await client.fetchQuery(scanRoomsQueryOptions())
    await client.prefetchQuery(completedSessionsQueryOptions())
    await loadMap(SEED_ZONES.HUMANITIES)
    const text = textOf(renderTab(SEED_ZONES.HUMANITIES))

    expect(text).toContain('점검 이력 확인 실패')
    expect(text).toContain('불러오지 못한 정보: 최근 점검 회차')
    expect(text).not.toContain('점검 이력 없음')
    expect(text).not.toContain('점검 이력이 없어')
  })

  it('서가를 새로 불러오지 못하면 배치는 유지하고 정상 표시만 숨긴다', async () => {
    await loadTab(SEED_ZONES.SOCIAL, 120)
    const observer = new QueryObserver(client, shelvesQueryOptions({ zone: SEED_ZONES.SOCIAL, includeInactive: true }))
    vi.spyOn(getScanStore(), 'getShelves').mockImplementation(() => {
      throw new Error('실패')
    })
    await observer.refetch()
    const html = renderTab(SEED_ZONES.SOCIAL)

    expect(markersOf(html)).toEqual({ 'B-01': '', 'B-02': 'disposal', 'B-03': '', 'B-04': '' })
    expect(textOf(html)).toContain('새로 불러오지 못해 이전 결과를 표시: 서가 목록')
  })

  it('서가를 한 번도 받지 못하면 배치도 대신 오류와 재시도를 보여 준다', async () => {
    await client.fetchQuery(scanRoomsQueryOptions())
    await client.fetchQuery(completedSessionsQueryOptions())
    vi.spyOn(getScanStore(), 'getShelves').mockImplementation(() => {
      throw new Error('실패')
    })
    await client.prefetchQuery(shelvesQueryOptions({ zone: SEED_ZONES.HUMANITIES, includeInactive: true }))
    const html = renderTab(SEED_ZONES.HUMANITIES)

    expect(textOf(html)).toContain('서가 배치를 불러오지 못했습니다. 다시 시도')
    expect(html).not.toContain('shelf-node')
  })

  it('한 자료실에 층이 둘이면 층을 고르고 낮은 층부터 그린다', async () => {
    const data = createSeedData()
    data.shelves.find((s) => s.shelfCode === 'A-03')!.floorNo = 4
    resetScanStore({ data })
    await loadTab(SEED_ZONES.HUMANITIES, 5)
    const html = renderTab(SEED_ZONES.HUMANITIES)

    expect(textOf(/aria-label="층 선택">.*?<\/div>/.exec(html)![0])).toContain('3층 4층')
    expect(Object.keys(markersOf(html))).not.toContain('A-03')
  })
})

describe('회차의 배치도', () => {
  it('검토 중 회차는 분석 결과만 표시하고 후보를 조회하지 않는다', async () => {
    await loadSessionMap(2)
    const reads = [
      vi.spyOn(getScanStore(), 'getMissingCandidates'),
      vi.spyOn(getScanStore(), 'getDisposalCandidatesByShelf'),
    ]
    const html = renderSession(2)
    const markers = Object.values(markersOf(html)).join(' ')

    expect(textOf(html)).toContain('검토 중 · 시작 2026.11.03')
    expect(textOf(html)).toContain('확정 후 산출됩니다.')
    expect(html).not.toContain('<select')
    expect(markers).toMatch(/misplaced|reviewRequired/)
    expect(markers).not.toMatch(/normal|missing|disposal/)
    for (const read of reads) expect(read).not.toHaveBeenCalled()
  })

  it('결과를 기다리는 회차는 수신 대기로 표시한다', async () => {
    await loadSessionMap(1)
    const html = renderSession(1)

    expect(html).toContain('aria-label="A-01 서가, 수신 대기"')
    expect(Object.values(markersOf(html)).join('')).toBe('')
  })

  it('회차가 없다는 응답을 받으면 캐시가 있어도 배치를 보여 주지 않는다', async () => {
    await loadSessionMap(5)
    vi.spyOn(getScanStore(), 'getAnalysis').mockImplementation(() => {
      throw new ApiError(404, { code: ERROR_CODE.SCAN_SESSION_NOT_FOUND, message: 'x', errors: [] })
    })
    await client.refetchQueries({ queryKey: scanAnalysisQueryOptions(5).queryKey })
    const html = renderSession(5)

    expect(textOf(html)).toContain('장서점검 회차를 찾을 수 없습니다.')
    expect(html).not.toContain('shelf-node')
  })

  it('폐기 검토 후보의 다음 페이지에서 회차가 없다는 응답을 받아도 배치를 보여 주지 않는다', async () => {
    await loadSessionMap(5)
    expect(renderSession(5)).toContain('shelf-node')
    await failNextDisposalPage(5, new ApiError(404, { code: ERROR_CODE.SCAN_SESSION_NOT_FOUND, message: 'x', errors: [] }))
    const html = renderSession(5)

    expect(textOf(html)).toContain('장서점검 회차를 찾을 수 없습니다.')
    expect(html).not.toContain('shelf-node')
    expect(html).not.toContain('data-markers')
  })

  it('폐기 검토 후보의 다음 페이지가 그 밖의 오류로 실패하면 받아 둔 평가 현황을 그대로 쓴다', async () => {
    const store = getScanStore()
    const read = store.getDisposalCandidates
    // 평가 현황으로 정상 표시를 하는 회차에 다음 페이지가 있는 것으로 만든다.
    vi.spyOn(store, 'getDisposalCandidates').mockImplementation((id, params) => {
      const response = read(id, params)
      return { ...response, page: { ...response.page, totalPages: 2 } }
    })
    await loadSessionMap(120)
    const before = renderSession(120)
    await failNextDisposalPage(120, new Error('network'))
    const html = renderSession(120)

    expect(Object.values(markersOf(html))).toContain('normal')
    expect(markersOf(html)).toEqual(markersOf(before))
    expect(textOf(html)).not.toContain('가치평가 현황')
  })

  it('올바르지 않은 회차 주소를 알린다', () => {
    expect(textOf(renderSession(0))).toContain('올바르지 않은 회차 주소입니다')
  })
})

describe('서가 요약', () => {
  const entry = (overrides: Partial<ShelfMapEntry> = {}): ShelfMapEntry => ({
    shelfId: 1,
    shelfCode: 'A-01',
    shelf: null,
    placed: true,
    inspection: 'observed',
    analysis: { total: 5, normal: 2, misplaced: 2, reviewRequired: 1 },
    missing: { total: 3, closed: 1 },
    disposal: 0,
    markers: ['misplaced', 'reviewRequired', 'missing'],
    ...overrides,
  })
  const status = (overrides: Partial<ShelfMapStatus> = {}): ShelfMapStatus => ({
    analysis: 'ready',
    missing: 'ready',
    disposal: 'ready',
    evaluation: 'complete',
    ...overrides,
  })
  const texts = (e: ShelfMapEntry, s: ShelfMapStatus) => shelfSummary(e, s).map((item) => item.text)
  const clean = (overrides: Partial<ShelfMapEntry> = {}) =>
    entry({
      analysis: { total: 5, normal: 5, misplaced: 0, reviewRequired: 0 },
      missing: { total: 0, closed: 0 },
      markers: [],
      ...overrides,
    })

  it('0건이 아닌 분류만 색 표시, 건수와 함께 쓴다', () => {
    expect(shelfSummary(entry(), status())).toEqual([
      { marker: 'misplaced', text: '오배치 2건' },
      { marker: 'reviewRequired', text: '검토 필요 1건' },
      { marker: 'missing', text: '소재불명 3권' },
    ])
    expect(texts(entry({ disposal: 2 }), status())).toContain('폐기 검토 2권')
  })

  it('정상 서가는 정상만 쓴다', () => {
    expect(shelfSummary(clean({ markers: ['normal'] }), status())).toEqual([{ marker: 'normal', text: '정상' }])
  })

  it.each<[string, Partial<ShelfMapStatus>, Partial<ShelfMapEntry>, string]>([
    ['평가 없음', { evaluation: 'none' }, { disposal: null }, '폐기 검토 미산출'],
    ['전체 평가 불가', { evaluation: 'allNotEvaluable' }, { disposal: null }, '폐기 검토 미산출'],
    ['평가 현황 실패', { evaluation: 'error' }, {}, '폐기 검토 확인 불가'],
    ['폐기 후보 조회 실패', { disposal: 'error' }, { disposal: null }, '폐기 검토 확인 불가'],
    ['소재불명 조회 실패', { missing: 'error' }, { missing: null }, '소재불명 확인 불가'],
    ['후보 조회 중', { missing: 'loading' }, { missing: null }, '불러오는 중'],
    ['일부 평가 불가', { evaluation: 'partial' }, {}, '판정 보류'],
    ['확정 전', { missing: 'notProduced', disposal: 'notProduced', evaluation: 'notProduced' }, { missing: null, disposal: null }, '판정 보류'],
  ])('%s인 서가는 정상이나 0건으로 쓰지 않는다', (_label, statusOverrides, entryOverrides, text) => {
    expect(texts(clean(entryOverrides), status(statusOverrides))).toEqual([text])
  })

  it('점검하지 않은 서가는 상태를 쓰고 있는 후보를 함께 쓴다', () => {
    const notTargeted = clean({ inspection: 'notTargeted', analysis: null, disposal: 2, markers: ['disposal'] })
    expect(texts(notTargeted, status())).toEqual(['점검 대상 아님', '폐기 검토 2권'])
  })

  it('점검 이력이 없으면 후보를 말하지 않는다', () => {
    const summary = shelfSummary(
      entry({ inspection: 'noSession', analysis: null, missing: null, disposal: null, markers: [] }),
      status({ analysis: 'notProduced', missing: 'notProduced', disposal: 'notProduced', evaluation: 'notProduced' }),
    )
    expect(summary).toEqual([{ text: '점검 이력 없음' }])
  })
})
