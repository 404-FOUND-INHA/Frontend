import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Page from '@/components/common/Page'
import { PlusIcon, UserIcon } from '@/components/common/icons'
import { useScanSessions } from '@/hooks/scan/useScanSessions'
import ScanSessionCard from './ScanSessionCard'
import ScanStatusFilter from './ScanStatusFilter'
import {
  EMPTY_MESSAGE,
  STATUS_FILTERS,
  STATUS_QUERY_PARAM,
  getListViewState,
  parseStatusFilter,
  type StatusFilterKey,
} from './scanListView'
import { FROM_LIST_STATE, SCAN_NAV_ENABLED, scanPaths } from './scanPaths'
import './scanList.css'

function CreateFab() {
  return SCAN_NAV_ENABLED.create ? (
    <Link to={scanPaths.create} state={FROM_LIST_STATE} className="scan-fab" aria-label="회차 생성">
      <PlusIcon size={26} />
    </Link>
  ) : (
    // 생성 화면이 구현되기 전에는 동작하지 않는다.
    <button type="button" className="scan-fab" disabled aria-label="회차 생성 (준비 중)">
      <PlusIcon size={26} />
    </button>
  )
}

// 장서점검 회차 목록. 상태 필터는 URL(?status=)이 유일한 상태이다.
export default function ScanListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filterKey = parseStatusFilter(searchParams.getAll(STATUS_QUERY_PARAM))
  const filter = STATUS_FILTERS.find((item) => item.key === filterKey) ?? STATUS_FILTERS[0]

  const query = useScanSessions(filter.statuses)
  const sessions = query.data?.pages.flatMap((page) => page.content) ?? []
  const view = getListViewState({
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    hasNextPage: query.hasNextPage,
    itemCount: sessions.length,
  })

  // 필터가 바뀌면(칩 선택, 뒤로·앞으로) 새 목록의 맨 위부터 보이도록 본문 스크롤을 처음으로 되돌린다.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.closest('.pg-scroll')?.scrollTo({ top: 0 })
  }, [filterKey])

  const selectFilter = (key: StatusFilterKey) => {
    if (key === filterKey) return
    const next = new URLSearchParams(searchParams) // 다른 파라미터는 보존한다.
    next.delete(STATUS_QUERY_PARAM)
    if (key !== 'all') next.set(STATUS_QUERY_PARAM, key)
    setSearchParams(next)
  }

  return (
    <Page
      title="장서점검 기록"
      tone="gray"
      right={
        // 아직 연결된 기능이 없는 버튼: 동작하지 않도록 disabled
        <button type="button" className="pg-action" disabled aria-label="내 정보 (준비 중)">
          <UserIcon size={18} />
        </button>
      }
    >
      <div className="scan-list" ref={rootRef}>
        <ScanStatusFilter value={filterKey} onChange={selectFilter} />

        {view.body === 'loading' && <p className="scan-state">불러오는 중…</p>}

        {view.body === 'error' && (
          <div className="scan-state">
            <p>목록을 불러오지 못했습니다</p>
            <button type="button" className="scan-retry" disabled={view.busy} onClick={() => void query.refetch()}>
              {view.busy ? '불러오는 중…' : '다시 시도'}
            </button>
          </div>
        )}

        {view.body === 'empty' && <p className="scan-state">{EMPTY_MESSAGE[filterKey]}</p>}

        {view.body === 'list' && (
          <>
            {view.refreshing && <p className="scan-notice" role="status">갱신 중…</p>}
            {view.refreshError && (
              <div className="scan-notice scan-notice--error" role="alert">
                <span>목록을 새로 불러오지 못했습니다</span>
                <button type="button" className="scan-retry" disabled={view.busy} onClick={() => void query.refetch()}>
                  {view.busy ? '불러오는 중…' : '다시 시도'}
                </button>
              </div>
            )}
            <ul className="scan-cards">
              {sessions.map((session) => (
                <li key={session.id}>
                  <ScanSessionCard session={session} />
                </li>
              ))}
            </ul>
            {view.nextPageError && (
              <div className="scan-notice scan-notice--error" role="alert">
                <span>다음 목록을 불러오지 못했습니다</span>
                <button type="button" className="scan-retry" disabled={view.busy} onClick={() => void query.loadMore()}>
                  {view.busy ? '불러오는 중…' : '다시 시도'}
                </button>
              </div>
            )}
            {view.showMore && (
              <button type="button" className="scan-more" disabled={view.busy} onClick={() => void query.loadMore()}>
                {view.moreLoading ? '불러오는 중…' : '더보기'}
              </button>
            )}
          </>
        )}

        <CreateFab />
      </div>
    </Page>
  )
}
