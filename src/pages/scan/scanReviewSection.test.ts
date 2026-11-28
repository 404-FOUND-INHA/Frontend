import { MutationObserver, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { createElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanKeys } from '@/hooks/scan/queryKeys'
import { finalizeScanSessionMutationOptions } from '@/hooks/scan/useFinalizeScanSession'
import { scanAnalysisQueryOptions } from '@/hooks/scan/useScanAnalysis'
import { scanReviewsQueryOptions } from '@/hooks/scan/useScanReviews'
import { scanSessionQueryOptions } from '@/hooks/scan/useScanSession'
import { getScanStore, resetScanStore } from '@/mocks/scan/store'
import ScanDetailPage from './ScanDetailPage'
import ScanFinalizeDialog from './ScanFinalizeDialog'

// 실제 상세 화면을 정적 마크업으로 렌더링해, 쿼리·mutation 상태에 따른 화면을 확인한다.
// 정적 렌더링은 요청을 보내지 않으므로 필요한 상태는 캐시에 먼저 만든다. 클릭 동작은 다루지 않는다.

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
const loadReviews = (id: number) => client.fetchQuery(scanReviewsQueryOptions(id))
async function load(id: number) {
  await loadSession(id)
  await loadReviews(id)
}

/** 태그를 지운 화면 문구 */
const textOf = (html: string) => html.replaceAll('<!-- -->', '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

/** 버튼 문구와 비활성 여부 */
const buttonsOf = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attributes, inner]) => ({
    text: textOf(inner).trim(),
    disabled: attributes.includes(' disabled=""'),
  }))
const button = (html: string, text: string) => buttonsOf(html).find((b) => b.text.startsWith(text))

const confirmButton = (html: string) => button(html, '점검 회차 확정')
const progressOf = (html: string) => {
  const bar = /role="progressbar"[^>]*aria-valuemax="(\d+)" aria-valuenow="(\d+)"[^>]*><span style="width:([^"]+)"/.exec(html)
  return bar ? { max: Number(bar[1]), now: Number(bar[2]), width: bar[3] } : null
}

describe('회차 상태별 검토 영역', () => {
  it('IN_PROGRESS: 검토 영역, 배치도·확정 버튼이 없고 검토를 조회하지 않는다', async () => {
    await loadSession(1)
    const read = vi.spyOn(getScanStore(), 'getReviews')
    const html = renderPage(1)

    expect(html).not.toContain('이상 도서 검토 현황')
    expect(html).not.toContain('서가 배치도')
    expect(confirmButton(html)).toBeUndefined()
    expect(client.getQueryCache().findAll({ queryKey: ['scan', 'reviews'] })).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it('REVIEW 미처리 있음: 건수와 진행 막대를 보이고 확정할 수 없다', async () => {
    await load(2)
    const html = renderPage(2)
    const text = textOf(html)

    expect(html.indexOf('이상 도서 검토 현황')).toBeGreaterThan(html.indexOf('자동 분석 결과'))
    expect(text).toContain('2 / 3건')
    expect(text).toContain('검토 완료 2건')
    expect(text).toContain('미처리 1건')
    expect(progressOf(html)).toMatchObject({ max: 3, now: 2 })
    expect(progressOf(html)?.width).toMatch(/^66\.6+\d*%$/)
    expect(confirmButton(html)?.disabled).toBe(true)
    expect(text).toContain('필수 검토 완료 후 회차를 확정할 수 있습니다.')
  })

  it('REVIEW 검토 완료: 확정할 수 있다', async () => {
    await load(3)
    const html = renderPage(3)

    expect(textOf(html)).toContain('7 / 7건')
    expect(progressOf(html)).toStrictEqual({ max: 7, now: 7, width: '100%' })
    expect(confirmButton(html)).toStrictEqual({ text: '점검 회차 확정', disabled: false })
    expect(textOf(html)).toContain('모든 필수 검토가 완료되었습니다.')
    expect(html).not.toContain('<dialog')
  })

  it('REVIEW 필수 검토 0건: 분수와 막대 대신 안내하고 확정할 수 있다', async () => {
    await load(4)
    const html = renderPage(4)
    const text = textOf(html)

    expect(text).toContain('필수 검토 대상이 없습니다.')
    expect(progressOf(html)).toBeNull()
    expect(text).not.toContain('0 / 0건')
    expect(text).toContain('검토 완료 0건')
    expect(confirmButton(html)?.disabled).toBe(false)
    expect(text).toContain('바로 회차를 확정할 수 있습니다.')
  })

  it('COMPLETED: 검토 현황을 유지하고 확정 버튼은 없다', async () => {
    await load(5)
    const html = renderPage(5)

    expect(textOf(html)).toContain('1 / 1건')
    expect(confirmButton(html)).toBeUndefined()
    expect(html).not.toContain('확정할 수 있습니다')
  })

  it.each([2, 5])('회차 %i: 그 회차의 서가 배치도로 이동하는 링크가 있다', async (id) => {
    await load(id)
    const html = renderPage(id)

    expect(html).toMatch(new RegExp(`<a class="scan-layout-btn" href="/scan/${id}/shelf-map"[^>]*>서가 배치도 보러가기`))
    expect(button(html, '서가 배치도 보러가기')).toBeUndefined()
  })
})

describe('검토 조회 상태와 확정 버튼', () => {
  const expectNoCounts = (html: string) => {
    expect(textOf(html)).not.toMatch(/(검토 완료|미처리) \d+건/)
    expect(progressOf(html)).toBeNull()
    expect(html).not.toContain('필수 검토 대상이 없습니다')
    expect(confirmButton(html)?.disabled).toBe(true)
    expect(textOf(html)).toContain('검토 현황을 확인한 뒤 회차를 확정할 수 있습니다.')
  }
  const failReviews = () =>
    vi.spyOn(getScanStore(), 'getReviews').mockImplementation(() => {
      throw new Error('network')
    })

  it('로딩: 0건으로 표시하지 않는다', async () => {
    await loadSession(4)
    const html = renderPage(4)

    expect(html).toContain('검토 현황을 불러오는 중…')
    expectNoCounts(html)
  })

  it('최초 조회 실패: 0건으로 표시하지 않고 다시 시도를 제공한다', async () => {
    await loadSession(4)
    failReviews()
    await expect(loadReviews(4)).rejects.toThrow('network')
    const html = renderPage(4)

    expect(html).toContain('검토 현황을 불러오지 못했습니다.')
    expect(button(html, '다시 시도')?.disabled).toBe(false)
    expectNoCounts(html)
  })

  it('재조회 실패: 기존 건수를 유지하고 다시 시도를 제공하며 확정할 수 없다', async () => {
    await load(3)
    failReviews()
    await client.refetchQueries({ queryKey: scanKeys.sessionReviews(3) })
    const html = renderPage(3)

    expect(html).toContain('검토 현황을 새로 불러오지 못했습니다.')
    expect(textOf(html)).toContain('7 / 7건')
    expect(button(html, '다시 시도')?.disabled).toBe(false)
    expect(confirmButton(html)?.disabled).toBe(true)
  })

  it('재조회 중: 확정할 수 없고, 끝나면 다시 확정할 수 있다', async () => {
    await load(3)
    const observer = new QueryObserver(client, scanReviewsQueryOptions(3))
    const unsubscribe = observer.subscribe(() => {})
    const refetching = observer.refetch()

    expect(confirmButton(renderPage(3))?.disabled).toBe(true)
    await refetching
    expect(confirmButton(renderPage(3))?.disabled).toBe(false)
    unsubscribe()
  })

  it('분석 조회에 실패해도 확정 조건은 달라지지 않는다', async () => {
    await load(3)
    vi.spyOn(getScanStore(), 'getAnalysis').mockImplementation(() => {
      throw new Error('network')
    })
    await expect(client.fetchQuery(scanAnalysisQueryOptions(3))).rejects.toThrow('network')
    const html = renderPage(3)

    expect(html).toContain('분석 결과를 불러오지 못했습니다.')
    expect(confirmButton(html)?.disabled).toBe(false)
  })
})

describe('확정 진행과 결과', () => {
  const mutate = (id: number) => new MutationObserver(client, finalizeScanSessionMutationOptions(client, id)).mutate()

  it('다시 연 화면에서도 진행 중인 회차의 확정 버튼은 비활성이고, 다른 회차는 영향이 없다', async () => {
    await load(3)
    await load(4)
    const running = mutate(3) // 이 화면의 컴포넌트가 시작하지 않은 요청

    expect(button(renderPage(3), '확정 중…')?.disabled).toBe(true)
    expect(confirmButton(renderPage(3))).toBeUndefined()
    expect(confirmButton(renderPage(4))?.disabled).toBe(false)
    await running
  })

  it('성공하면 완료 상태와 확정일을 보이고 확정 버튼이 사라지며, 분석·검토 현황은 남는다', async () => {
    await load(3)
    await client.fetchQuery(scanAnalysisQueryOptions(3))

    await mutate(3)
    const html = renderPage(3)
    const text = textOf(html)

    expect(text).toContain('확정일: 2026.11.26')
    expect(text).toContain('장서점검이 완료되었습니다')
    expect(confirmButton(html)).toBeUndefined()
    expect(button(html, '확정 중…')).toBeUndefined()
    expect(text).toContain('자동 분석 결과')
    expect(text).toContain('전체 관측 96 건')
    expect(text).toContain('7 / 7건')
    expect(html).toContain('href="/scan/3/shelf-map"')
  })

  it('성공 후 다른 조회의 재조회가 실패해도 확정 버튼은 다시 나타나지 않는다', async () => {
    await load(3)
    const observers = [scanSessionQueryOptions(3), scanReviewsQueryOptions(3)].map(
      (options) => new QueryObserver<unknown>(client, options as never),
    )
    const unsubscribers = observers.map((observer) => observer.subscribe(() => {}))
    for (const method of ['getSession', 'getReviews'] as const) {
      vi.spyOn(getScanStore(), method).mockImplementation(() => {
        throw new Error('network')
      })
    }

    await mutate(3)
    const html = renderPage(3)

    expect(textOf(html)).toContain('장서점검이 완료되었습니다')
    expect(html).toContain('검토 현황을 새로 불러오지 못했습니다.')
    expect(confirmButton(html)).toBeUndefined()
    for (const unsubscribe of unsubscribers) unsubscribe()
  })
})

describe('확정 확인 모달', () => {
  const props: ComponentProps<typeof ScanFinalizeDialog> = {
    sessionName: '2026년 2학기 정기 장서점검',
    summary: { totalRequired: 7, reviewed: 7, remaining: 0 },
    guide: '모든 필수 검토가 완료되었습니다.',
    pending: false,
    canConfirm: true,
    errorText: null,
    onCancel: () => {},
    onConfirm: () => {},
  }
  const renderDialog = (overrides: Partial<typeof props> = {}) =>
    render(createElement(ScanFinalizeDialog, { ...props, ...overrides }))

  it('회차명, 검토 현황, 변경 불가 안내와 취소·확정 버튼을 보인다', () => {
    const html = renderDialog()
    const text = textOf(html)

    expect(html).toMatch(/<dialog class="scan-dialog" aria-labelledby="[^"]+"/)
    for (const expected of [
      '점검 회차 확정',
      '2026년 2학기 정기 장서점검',
      '이상 도서 검토 7 / 7건 완료',
      '미처리 건수 0건',
      '확정한 뒤에는 검토 결과를 변경할 수 없습니다.',
    ]) {
      expect(text).toContain(expected)
    }
    expect(buttonsOf(html)).toStrictEqual([
      { text: '취소', disabled: false },
      { text: '확정', disabled: false },
    ])
    expect(html).not.toContain('role="alert"')
  })

  it('필수 검토 0건은 대상 없음으로 표시한다', () => {
    const text = textOf(renderDialog({ summary: { totalRequired: 0, reviewed: 0, remaining: 0 } }))
    expect(text).toContain('이상 도서 검토 대상 없음')
    expect(text).not.toContain('0 / 0')
  })

  it('처리 중에는 두 버튼을 모두 막고 이전 오류를 숨긴다', () => {
    const html = renderDialog({ pending: true, canConfirm: false, errorText: '실패' })
    expect(buttonsOf(html)).toStrictEqual([
      { text: '취소', disabled: true },
      { text: '확정 중…', disabled: true },
    ])
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('role="alert"')
  })

  it('실패하면 모달 안에 안내하고 다시 시도할 수 있다', () => {
    const html = renderDialog({ errorText: '회차를 확정하지 못했습니다.' })
    expect(html).toMatch(/role="alert">회차를 확정하지 못했습니다\./)
    expect(buttonsOf(html).map((b) => b.disabled)).toEqual([false, false])
  })

  it('확정할 수 없게 되면 확정만 막고, 검토 현황을 모르면 건수를 보이지 않는다', () => {
    const html = renderDialog({ summary: null, canConfirm: false })
    expect(buttonsOf(html).map((b) => b.disabled)).toEqual([false, true])
    expect(html).not.toContain('<dl')
  })
})
