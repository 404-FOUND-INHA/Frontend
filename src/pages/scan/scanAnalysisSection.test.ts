import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { scanKeys } from '@/hooks/scan/queryKeys'
import { scanAnalysisQueryOptions } from '@/hooks/scan/useScanAnalysis'
import { scanSessionQueryOptions } from '@/hooks/scan/useScanSession'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import ScanAnalysisSection from './ScanAnalysisSection'
import ScanDetailPage from './ScanDetailPage'
import { retryScanAnalysis } from './scanAnalysisView'

// 실제 컴포넌트를 정적 마크업으로 렌더링해, 쿼리 캐시 상태에 따른 화면을 확인한다.
// 정적 렌더링은 요청을 보내지 않으므로, 필요한 상태는 캐시에 먼저 만든다. 클릭 동작은 다루지 않는다.

let client: QueryClient

beforeEach(() => {
  resetScanStore()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false, staleTime: 60_000 } },
  })
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

const render = (element: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, element))

const renderSection = (sessionId: number) => render(createElement(ScanAnalysisSection, { sessionId }))

const renderPage = (path: string) =>
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/scan/:sessionId', element: createElement(ScanDetailPage) }),
      ),
    ),
  )

const loadAnalysis = (id: number) => client.fetchQuery(scanAnalysisQueryOptions(id))
const loadSession = (id: number) => client.fetchQuery(scanSessionQueryOptions(id))
const analysisQuery = (id: number) => client.getQueryCache().find({ queryKey: scanKeys.analysis(id) })

/** 카드 이름과 값·단위. 마크업 순서대로 */
const cardsOf = (html: string) =>
  [...html.matchAll(/<dt>([^<]+)<\/dt><dd><strong>([^<]+)<\/strong><span>([^<]+)<\/span><\/dd>/g)].map(
    ([, label, value, unit]) => `${label} ${value}${unit}`,
  )
const buttonsOf = (html: string) =>
  [...html.matchAll(/<button[^>]*?( disabled="")?>([^<]*)<\/button>/g)].map(([, disabled, text]) => ({
    text,
    disabled: disabled !== undefined,
  }))

/** 성공한 캐시를 만든 뒤 재조회를 지정한 오류로 실패시킨다. */
async function failRefetch(id: number, error: Error = new Error('network')) {
  await loadAnalysis(id)
  vi.spyOn(getScanStore(), 'getAnalysis').mockImplementation(() => {
    throw error
  })
  await client.refetchQueries({ queryKey: scanKeys.analysis(id) })
}

const sessionMissing = new ApiError(404, { code: ERROR_CODE.SCAN_SESSION_NOT_FOUND, message: 'x', errors: [] })

describe('분석 결과 영역', () => {
  it.each([
    [2, ['전체 관측 128건', '정상 120건', '오배치 5건', '검토 필요 3건']],
    [3, ['전체 관측 96건', '정상 83건', '오배치 6건', '검토 필요 7건']],
    [5, ['전체 관측 112건', '정상 108건', '오배치 3건', '검토 필요 1건']],
    [7, ['전체 관측 90건', '정상 90건', '오배치 0건', '검토 필요 0건']],
  ])('회차 %i: Mock 응답의 건수를 네 칸에 표시한다', async (id, expected) => {
    await loadAnalysis(id)
    const html = renderSection(id)

    expect(html).toContain('자동 분석 결과')
    expect(cardsOf(html)).toEqual(expected)
    expect(html).not.toContain('관측된 도서가 없습니다')
    expect(html).not.toContain('인식 불가')
    expect(buttonsOf(html)).toEqual([])
  })

  it('캐시가 없으면 로딩 문구만 표시한다', () => {
    const html = renderSection(2)
    expect(html).toContain('분석 결과를 불러오는 중…')
    expect(cardsOf(html)).toEqual([])
    expect(buttonsOf(html)).toEqual([])
  })

  it('수신 완료 0건: 네 칸을 0건으로 표시하고 안내한다', async () => {
    await loadAnalysis(4)
    const html = renderSection(4)

    expect(cardsOf(html)).toEqual(['전체 관측 0건', '정상 0건', '오배치 0건', '검토 필요 0건'])
    expect(html).toContain('자동 분석에서 관측된 도서가 없습니다.')
    expect(html).not.toContain('분석 결과가 아직 없습니다')
  })

  it('수신 전 응답: 카드 대신 안내와 다시 시도를 표시한다', async () => {
    await loadAnalysis(1)
    const html = renderSection(1)

    expect(html).toContain('분석 결과가 아직 없습니다.')
    expect(html).not.toContain('관측된 도서가 없습니다')
    expect(cardsOf(html)).toEqual([])
    expect(buttonsOf(html)).toEqual([{ text: '다시 시도', disabled: false }])
  })

  it('최초 조회 실패: 오류와 다시 시도를 표시한다', async () => {
    await expect(loadAnalysis(999_999)).rejects.toBeInstanceOf(ApiError)
    const html = renderSection(999_999)

    expect(html).toContain('분석 결과를 불러오지 못했습니다.')
    expect(cardsOf(html)).toEqual([])
    expect(buttonsOf(html)).toEqual([{ text: '다시 시도', disabled: false }])
  })

  it('재조회 실패: 기존 카드를 유지하고 오류 안내와 다시 시도를 표시한다', async () => {
    await failRefetch(2)
    const html = renderSection(2)

    expect(html).toContain('분석 결과를 새로 불러오지 못했습니다.')
    expect(cardsOf(html)).toHaveLength(4)
    expect(cardsOf(html)[0]).toBe('전체 관측 128건')
    expect(buttonsOf(html)).toEqual([{ text: '다시 시도', disabled: false }])
  })

  it('수신 전 화면에서 재조회에 실패해도 다시 시도 버튼은 하나다', async () => {
    await failRefetch(1)
    const html = renderSection(1)

    expect(html).toContain('분석 결과가 아직 없습니다.')
    expect(html).toContain('분석 결과를 새로 불러오지 못했습니다.')
    expect(buttonsOf(html)).toHaveLength(1)
  })

  it('재조회가 회차 없음으로 실패하면 이전 카드를 보여 주지 않는다', async () => {
    await failRefetch(2, sessionMissing)
    const html = renderSection(2)

    expect(html).toContain('분석 결과를 불러오지 못했습니다.')
    expect(cardsOf(html)).toEqual([])
    expect(buttonsOf(html)).toHaveLength(1)
  })

  it('다시 시도하는 동안 버튼은 비활성이며, 거듭 눌러도 요청은 한 번이고 성공하면 오류가 사라진다', async () => {
    await failRefetch(2)
    vi.restoreAllMocks()
    const read = vi.spyOn(getScanStore(), 'getAnalysis')
    const observer = new QueryObserver(client, scanAnalysisQueryOptions(2))
    const unsubscribe = observer.subscribe(() => {})

    retryScanAnalysis(2, observer.getCurrentResult().refetch)
    retryScanAnalysis(2, (options) => observer.refetch(options))
    expect(buttonsOf(renderSection(2))).toEqual([{ text: '불러오는 중…', disabled: true }])

    await vi.waitFor(() => expect(client.isFetching()).toBe(0))
    expect(read).toHaveBeenCalledOnce()
    const html = renderSection(2)
    expect(html).not.toContain('불러오지 못했습니다')
    expect(cardsOf(html)).toHaveLength(4)
    unsubscribe()
  })

  it('다른 회차의 캐시를 보여 주지 않는다', async () => {
    await loadAnalysis(2)
    const html = renderSection(3)

    expect(html).toContain('분석 결과를 불러오는 중…')
    expect(cardsOf(html)).toEqual([])
    expect(html).not.toContain('128')
  })
})

describe('회차 상세 화면 연결', () => {
  it('IN_PROGRESS: 분석 영역이 없고 분석 조회를 만들지 않는다', async () => {
    await loadSession(1)
    const read = vi.spyOn(getScanStore(), 'getAnalysis')
    const html = renderPage('/scan/1')

    expect(html).toContain('장서점검 처리 단계')
    expect(html).not.toContain('자동 분석 결과')
    expect(analysisQuery(1)).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    ['REVIEW', 2],
    ['COMPLETED', 5],
  ])('%s: 진행 단계 아래에 분석 영역을 두고 해당 회차를 조회한다', async (_status, id) => {
    await loadSession(id)
    const html = renderPage(`/scan/${id}`)

    expect(html.indexOf('자동 분석 결과')).toBeGreaterThan(html.indexOf('장서점검 진행 현황'))
    expect(html).toContain('분석 결과를 불러오는 중…')
    expect(analysisQuery(id)).toBeDefined()
    expect(client.getQueryCache().findAll({ queryKey: ['scan', 'analysis'] })).toHaveLength(1)
  })

  it('분석 조회에 실패해도 회차 요약과 진행 단계는 그대로다', async () => {
    await loadSession(2)
    vi.spyOn(getScanStore(), 'getAnalysis').mockImplementation(() => {
      throw new Error('network')
    })
    await expect(loadAnalysis(2)).rejects.toThrow('network')
    const html = renderPage('/scan/2')

    expect(html).toContain('2026년 2학기 정기 장서점검')
    expect(html).toContain('장서점검 진행 현황')
    expect(html).toContain('분석 결과를 불러오지 못했습니다.')
    expect(html).not.toContain('회차 정보를 불러오지 못했습니다')
  })

  it('회차를 바꾸면 그 회차의 건수만 표시한다', async () => {
    for (const id of [2, 5]) {
      await loadSession(id)
      await loadAnalysis(id)
    }
    expect(cardsOf(renderPage('/scan/2'))[0]).toBe('전체 관측 128건')
    const html = renderPage('/scan/5')
    expect(cardsOf(html)[0]).toBe('전체 관측 112건')
    expect(html).not.toContain('128')
  })

  it.each(['/scan/abc', '/scan/0', '/scan/999999'])('%s: 회차를 표시할 수 없으면 분석 조회를 만들지 않는다', async (path) => {
    if (path === '/scan/999999') await expect(loadSession(999_999)).rejects.toBeInstanceOf(ApiError)
    const html = renderPage(path)

    expect(html).not.toContain('자동 분석 결과')
    expect(client.getQueryCache().findAll({ queryKey: ['scan', 'analysis'] })).toEqual([])
  })
})
