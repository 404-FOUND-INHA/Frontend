import { InfiniteQueryObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { scanKeys } from '@/hooks/scan/queryKeys'
import { disposalCandidatesInfiniteQueryOptions } from '@/hooks/scan/useDisposalCandidates'
import { missingCandidatesInfiniteQueryOptions } from '@/hooks/scan/useMissingCandidates'
import { scanReviewsQueryOptions } from '@/hooks/scan/useScanReviews'
import { scanSessionQueryOptions } from '@/hooks/scan/useScanSession'
import { loadMoreScanSessions } from '@/hooks/scan/useScanSessions'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import type { MissingCandidateStatus } from '@/types/scan/missingCandidate'
import { DisposalCandidateItem, MissingCandidateItem } from './CandidateItems'
import CandidateSheet from './CandidateSheet'
import ScanDetailPage from './ScanDetailPage'
import { getResultViewState, getSheetFooterState } from './scanResultsView'

// 실제 상세 화면을 정적 마크업으로 렌더링해, 후보 조회 상태에 따른 화면을 확인한다.
// 정적 렌더링은 요청을 보내지 않으므로 필요한 상태는 캐시에 먼저 만든다. 시트 열기·닫기는 브라우저에서 확인한다.

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

const render = (element: ReactNode) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, element))

const renderPage = (id: number) =>
  render(
    createElement(
      MemoryRouter,
      { initialEntries: [`/scan/${id}`] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/scan/:sessionId', element: createElement(ScanDetailPage) }),
      ),
    ),
  )

const loadSession = (id: number) => client.fetchQuery(scanSessionQueryOptions(id))
const loadMissing = (id: number) => client.fetchInfiniteQuery(missingCandidatesInfiniteQueryOptions(id))
const loadDisposal = (id: number) => client.fetchInfiniteQuery(disposalCandidatesInfiniteQueryOptions(id))
async function load(id: number) {
  await loadSession(id)
  await Promise.all([loadMissing(id), loadDisposal(id)])
}

/** 태그를 지운 화면 문구 */
const textOf = (html: string) => html.replaceAll('<!-- -->', '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

/** 결과 영역 하나의 마크업 */
const sectionOf = (html: string, title: string) =>
  new RegExp(`<section class="scan-result" aria-label="${title}">.*?</section>`).exec(html)?.[0] ?? ''
const missingOf = (html: string) => sectionOf(html, '최종 점검 결과')
const disposalOf = (html: string) => sectionOf(html, '도서 가치평가 결과')

const buttonsOf = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attributes, inner]) => ({
    text: textOf(inner).trim(),
    disabled: attributes.includes(' disabled=""'),
  }))
const buttonTexts = (html: string) => buttonsOf(html).map((b) => b.text)

const fail = (method: 'getMissingCandidates' | 'getDisposalCandidates', error: Error = new Error('network')) =>
  vi.spyOn(getScanStore(), method).mockImplementation(() => {
    throw error
  })
const sessionMissing = new ApiError(404, { code: ERROR_CODE.SCAN_SESSION_NOT_FOUND, message: 'x', errors: [] })

describe('회차 상태별 결과 영역', () => {
  it.each([1, 2])('확정 전 회차 %i: 결과 영역이 없고 후보를 조회하지 않는다', async (id) => {
    await loadSession(id)
    if (id === 2) await client.fetchQuery(scanReviewsQueryOptions(id))
    const reads = [vi.spyOn(getScanStore(), 'getMissingCandidates'), vi.spyOn(getScanStore(), 'getDisposalCandidates')]
    const html = renderPage(id)

    expect(html).not.toContain('최종 점검 결과')
    expect(html).not.toContain('가치평가')
    for (const prefix of ['missingCandidates', 'disposalCandidates']) {
      expect(client.getQueryCache().findAll({ queryKey: ['scan', prefix] })).toEqual([])
    }
    for (const read of reads) expect(read).not.toHaveBeenCalled()
  })

  it('완료 회차: 분석, 검토 현황, 최종 결과, 가치평가, 배치도 버튼 순서다', async () => {
    await load(5)
    await client.fetchQuery(scanReviewsQueryOptions(5))
    const html = renderPage(5)
    const positions = [
      '자동 분석 결과',
      '이상 도서 검토 현황',
      '최종 점검 결과',
      '도서 가치평가 결과',
      '서가 배치도 보러가기',
    ].map((title) => html.indexOf(title))

    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(positions[0]).toBeGreaterThan(0)
    expect(html.match(/서가 배치도 보러가기/g)).toHaveLength(1)
    expect(buttonsOf(html).find((b) => b.text.startsWith('서가 배치도'))?.disabled).toBe(true)
  })
})

describe('결과 카드', () => {
  it.each<[number, string, string, string[]]>([
    [5, '소재불명 후보 2 권', '폐기 검토 후보 23 권', ['후보 내역 보기', '후보 내역 보기']],
    [6, '소재불명 후보 3 권', '폐기 검토 후보 0 권 폐기 검토 후보가 없습니다.', ['후보 내역 보기']],
    [7, '소재불명 후보 0 권 소재불명 후보가 없습니다.', '평가에 필요한 데이터가 부족하여 종합 점수를 산출할 수 없습니다.', []],
  ])('회차 %i', async (id, missing, disposal, buttons) => {
    await load(id)
    const html = renderPage(id)

    expect(textOf(missingOf(html))).toContain(missing)
    expect(textOf(disposalOf(html))).toContain(disposal)
    expect(buttonTexts(missingOf(html) + disposalOf(html))).toEqual(buttons)
    expect(html).not.toContain('<dialog')
  })

  const PARTLY_NOT_EVALUABLE = '일부 도서의 가치평가가 불가능합니다.'

  // 회차 5는 후보가 있고 평가 불가 3권, 회차 6은 후보가 없고 평가 불가 4권이다.
  it.each([
    [5, 23],
    [6, 0],
  ])('회차 %i: 일부 평가 불가는 안내만 하고 권수는 후보 %i권만 표시한다', async (id, candidates) => {
    await load(id)
    const text = textOf(disposalOf(renderPage(id)))

    expect(text).toContain(PARTLY_NOT_EVALUABLE)
    expect(text.match(/\d+ ?권/g)).toEqual([`${candidates} 권`])
  })

  it('평가 불가 도서가 없으면 안내하지 않는다', async () => {
    const response = getScanStore().getDisposalCandidates(5)
    vi.spyOn(getScanStore(), 'getDisposalCandidates').mockReturnValue({
      ...response,
      summary: { ...response.summary, notEvaluable: 0 },
    })
    await load(5)

    expect(textOf(disposalOf(renderPage(5)))).not.toContain(PARTLY_NOT_EVALUABLE)
  })

  it('모두 평가 불가이면 권수를 표시하지 않고 후보가 없다고 하지 않는다', async () => {
    await load(7)
    const text = textOf(disposalOf(renderPage(7)))

    expect(text).not.toContain('폐기 검토 후보가 없습니다')
    expect(text).not.toContain(PARTLY_NOT_EVALUABLE)
    expect(text).not.toMatch(/\d+ ?권/)
  })

  it('평가 결과가 없으면 원인을 단정하지 않고 다시 조회를 제공한다', async () => {
    await load(100)
    const section = disposalOf(renderPage(100))
    const text = textOf(section)

    expect(text).toContain('가치평가 결과가 없습니다. 평가가 실행되지 않았거나 평가할 도서가 없습니다.')
    expect(text).not.toContain('폐기 검토 후보가 없습니다')
    expect(text).not.toMatch(/\d+ ?권/)
    expect(buttonsOf(section)).toStrictEqual([{ text: '다시 조회', disabled: false }])
  })

  it('로딩: 건수나 없음 문구를 표시하지 않는다', async () => {
    await loadSession(5)
    const html = renderPage(5)

    expect(textOf(missingOf(html))).toContain('소재불명 후보를 불러오는 중…')
    expect(textOf(disposalOf(html))).toContain('가치평가 결과를 불러오는 중…')
    expect(textOf(missingOf(html) + disposalOf(html))).not.toMatch(/\d ?권|없습니다/)
  })

  it('한쪽의 최초 조회 실패는 그 영역에만 표시하고 0건으로 보이지 않는다', async () => {
    await loadSession(5)
    await loadDisposal(5)
    fail('getMissingCandidates')
    await expect(loadMissing(5)).rejects.toThrow('network')
    const html = renderPage(5)

    expect(textOf(missingOf(html))).toContain('소재불명 후보를 불러오지 못했습니다.')
    expect(textOf(missingOf(html))).not.toMatch(/\d ?권|없습니다/)
    expect(buttonsOf(missingOf(html))).toStrictEqual([{ text: '다시 시도', disabled: false }])
    expect(textOf(disposalOf(html))).toContain('폐기 검토 후보 23 권')
  })

  it('재조회 실패: 받아 둔 결과를 유지하고 다시 시도를 제공한다', async () => {
    await load(100)
    await load(5)
    fail('getMissingCandidates')
    fail('getDisposalCandidates')
    await client.refetchQueries({ queryKey: ['scan', 'missingCandidates', 5] })
    await client.refetchQueries({ queryKey: ['scan', 'disposalCandidates'] })

    const html = renderPage(5)
    expect(textOf(missingOf(html))).toContain('소재불명 후보를 새로 불러오지 못했습니다.')
    expect(textOf(missingOf(html))).toContain('2 권')
    expect(textOf(disposalOf(html))).toContain('23 권')

    // 평가 결과가 없는 회차의 재조회 실패에는 버튼이 하나다.
    expect(buttonTexts(disposalOf(renderPage(100)))).toEqual(['다시 시도'])
  })

  it('회차가 없다는 응답이면 받아 둔 결과를 보여 주지 않는다', async () => {
    await load(5)
    fail('getMissingCandidates', sessionMissing)
    fail('getDisposalCandidates', sessionMissing)
    await client.refetchQueries({ queryKey: ['scan', 'missingCandidates'] })
    await client.refetchQueries({ queryKey: ['scan', 'disposalCandidates'] })
    const html = renderPage(5)

    expect(textOf(missingOf(html))).toContain('소재불명 후보를 불러오지 못했습니다.')
    expect(textOf(disposalOf(html))).toContain('가치평가 결과를 불러오지 못했습니다.')
    expect(textOf(missingOf(html) + disposalOf(html))).not.toMatch(/\d ?권|후보 내역 보기/)
  })

  it('확정한 직후의 화면은 새 후보 건수를 보여 준다', async () => {
    getScanStore().finalizeSession(3)
    await load(3)

    expect(textOf(missingOf(renderPage(3)))).toContain('소재불명 후보 21 권')
    expect(textOf(disposalOf(renderPage(3)))).toContain('가치평가 결과가 없습니다.')
  })
})

describe('다음 페이지 조회 실패', () => {
  it('카드는 그대로 두고 시트의 더보기 자리에서만 알린다', async () => {
    await loadSession(5)
    const observer = new InfiniteQueryObserver(client, disposalCandidatesInfiniteQueryOptions(5))
    const unsubscribe = observer.subscribe(() => {})
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBeDefined())
    fail('getDisposalCandidates')
    await loadMoreScanSessions((options) => observer.fetchNextPage(options))
    const result = observer.getCurrentResult()
    unsubscribe()

    const view = getResultViewState(result)
    expect(view).toMatchObject({ body: 'result', refreshError: false })
    expect(getSheetFooterState({ ...result, refreshError: false })).toStrictEqual({
      nextPageError: true,
      showMore: false,
      moreLoading: false,
    })
    expect(textOf(disposalOf(renderPage(5)))).not.toContain('불러오지 못했습니다')
    expect(client.getQueryData(scanKeys.disposalCandidates(5))).toBeDefined()
  })
})

describe('후보 목록 시트', () => {
  const props: ComponentProps<typeof CandidateSheet> = {
    title: '폐기 검토 후보',
    tone: 'disposal',
    total: 23,
    refreshError: false,
    footer: { nextPageError: false, showMore: true, moreLoading: false },
    busy: false,
    onLoadMore: () => {},
    onRetry: () => {},
    onClose: () => {},
    children: createElement('li', null, '항목'),
  }
  const renderSheet = (overrides: Partial<typeof props> = {}) =>
    render(createElement(CandidateSheet, { ...props, ...overrides }))

  it('전체 건수는 불러온 항목 수와 따로 표시하고 닫기와 더보기를 제공한다', () => {
    const html = renderSheet()

    expect(html).toMatch(/<dialog class="scan-sheet scan-sheet--disposal" aria-labelledby="[^"]+"/)
    expect(textOf(html)).toContain('폐기 검토 후보 총 23권')
    expect(html).toContain('aria-label="닫기"')
    expect(buttonTexts(html)).toEqual(['×', '더보기'])
  })

  // 포커스 이동은 DOM이 필요해 브라우저에서 확인한다. 여기서는 옮겨 갈 목록이 키보드로 접근 가능한지만 지킨다.
  it.each<[string, 'missing' | 'disposal']>([
    ['소재불명 후보', 'missing'],
    ['폐기 검토 후보', 'disposal'],
  ])('%s 목록은 키보드 포커스를 받을 수 있고 이름이 있다', (title, tone) => {
    // 마지막 페이지를 받아 시트에 더보기 버튼이 없는 상태
    const html = renderSheet({ title, tone, footer: { nextPageError: false, showMore: false, moreLoading: false } })

    expect(html).toContain(`<div class="scan-sheet-body" tabindex="0" role="group" aria-label="${title} 목록">`)
    expect(buttonTexts(html)).toEqual(['×'])
  })

  it('다음 페이지를 불러오는 중에는 더보기를 막는다', () => {
    const html = renderSheet({ busy: true, footer: { nextPageError: false, showMore: true, moreLoading: true } })
    expect(buttonsOf(html)).toContainEqual({ text: '불러오는 중…', disabled: true })
  })

  it('다음 페이지 실패: 받은 목록을 유지하고 다시 시도를 제공한다', () => {
    const html = renderSheet({ footer: { nextPageError: true, showMore: false, moreLoading: false } })

    expect(textOf(html)).toContain('항목')
    expect(textOf(html)).toContain('다음 목록을 불러오지 못했습니다.')
    expect(buttonTexts(html)).toEqual(['×', '다시 시도'])
  })

  it('재조회 실패를 시트 안에서도 알린다', () => {
    const html = renderSheet({ refreshError: true, footer: { nextPageError: false, showMore: false, moreLoading: false } })

    expect(textOf(html)).toContain('목록을 새로 불러오지 못했습니다.')
    expect(buttonTexts(html)).toEqual(['×', '다시 시도'])
  })
})

describe('후보 항목', () => {
  const list = (items: ReactNode[]) => render(createElement('ul', null, ...items))

  it.each<[MissingCandidateStatus, string]>([
    ['PENDING', '확인 전'],
    ['FOUND', '찾음'],
    ['NOT_FOUND', '못 찾음'],
    ['LOST_CANDIDATE', '분실 의심'],
    ['RESOLVED', '종결'],
  ])('소재불명 후보 %s은 "%s"로 표시한다', (status, label) => {
    const [candidate] = getScanStore().getMissingCandidates(5).content
    const text = textOf(list([createElement(MissingCandidateItem, { candidate: { ...candidate, status } })]))

    expect(text).toContain(`확인 상태: ${label} 도서명 ${candidate.book.title}`)
    expect(text).toContain(`등록번호 ${candidate.book.registrationNo} 청구기호 ${candidate.book.callNumber}`)
    expect(text).toContain(`예상 서가 ${candidate.expectedShelfCode} 연속 미발견 1회`)
  })

  it('폐기 후보는 점수 두 자리와 현재 서가를 보이고, 평가 근거는 준비 중이다', () => {
    const [item] = getScanStore().getDisposalCandidates(5).page.content
    const html = list([createElement(DisposalCandidateItem, { item })])

    expect(textOf(html)).toContain(`도서명 ${item.title}`)
    expect(textOf(html)).toContain(`종합 평가 점수 94.00점 현재 서가 ${item.shelf?.shelfCode}`)
    expect(textOf(html)).not.toContain('예상 서가')
    expect(buttonsOf(html)).toStrictEqual([{ text: '평가 근거 보기 준비 중', disabled: true }])
  })

  it('서가가 없으면 "서가 미지정"이다', () => {
    const [candidate] = getScanStore().getMissingCandidates(5).content
    const [item] = getScanStore().getDisposalCandidates(5).page.content
    const text = textOf(
      list([
        createElement(MissingCandidateItem, { candidate: { ...candidate, expectedShelfCode: null } }),
        createElement(DisposalCandidateItem, { item: { ...item, shelf: null } }),
      ]),
    )

    expect(text).toContain('예상 서가 서가 미지정')
    expect(text).toContain('현재 서가 서가 미지정')
  })
})
