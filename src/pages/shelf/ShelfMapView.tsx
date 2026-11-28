import { useState, type ReactNode } from 'react'
import { SearchIcon, UserIcon } from '@/components/common/icons'
import { useAllMissingCandidates } from '@/hooks/scan/useAllMissingCandidates'
import { useDisposalCandidates } from '@/hooks/scan/useDisposalCandidates'
import { useDisposalCandidatesByShelf } from '@/hooks/scan/useDisposalCandidatesByShelf'
import { useScanAnalysis } from '@/hooks/scan/useScanAnalysis'
import { useShelves } from '@/hooks/scan/useShelves'
import type { ScanSessionResponse } from '@/types/scan/api'
import ShelfMapCanvas, { type PlacedShelf } from './ShelfMapCanvas'
import ShelfSummaryCard from './ShelfSummaryCard'
import { shelfShape } from './mapGeometry'
import { NOT_PRODUCED, buildShelfMapModel, toSource, type ShelfMapModel, type Source } from './shelfMapModel'
import { LEGEND_MARKERS, MARKER_LABEL, formatFloor, shelfAccessibleName, type ShelfMapStatus } from './shelfMapText'
import './shelfMap.css'

/** 배치도의 기준 회차. none: 점검 이력이 없다. loading·error: 기준 회차를 아직 정하지 못했다. */
export type MapBasis = { status: 'ready'; session: ScanSessionResponse } | { status: 'none' | 'loading' | 'error' }

/** 배치도 바깥(화면)에서 조회에 실패한 정보 */
export interface MapProblem {
  label: string
  /** 받아 둔 값을 보여 주는 중인가 */
  stale: boolean
  retry: () => void
}

interface ShelfMapViewProps {
  zone: string
  basis: MapBasis
  problems: MapProblem[]
}

interface TrackedQuery {
  data: unknown
  isError: boolean
  isFetching: boolean
  refetch: (options: { cancelRefetch: boolean }) => unknown
}

/**
 * 한 자료실의 서가 배치도. 기준 회차의 분석 결과와 후보를 조회해 서가별로 표시한다.
 * 자료실이나 기준 회차가 바뀌면 key로 새로 마운트해 선택과 확대 상태를 이어받지 않는다.
 */
export default function ShelfMapView({ zone, basis, problems }: ShelfMapViewProps) {
  const session = basis.status === 'ready' ? basis.session : null
  // 후보는 확정한 회차에만 있다. 조회하지 않을 때는 NaN을 넘긴다.
  const completedId = session?.status === 'COMPLETED' ? session.id : Number.NaN
  const shelvesQuery = useShelves({ zone, includeInactive: true })
  const analysisQuery = useScanAnalysis(session?.id ?? Number.NaN)
  const missingQuery = useAllMissingCandidates(completedId)
  const disposalQuery = useDisposalCandidatesByShelf(completedId)
  const evaluationQuery = useDisposalCandidates(completedId)

  // 조회하지 않는 분류: 이력이 없거나 확정 전이면 산출 대상이 아니고, 기준 회차를 모르면 로딩·오류다.
  const idle: Source<never> =
    basis.status === 'loading' || basis.status === 'error' ? { status: basis.status } : NOT_PRODUCED
  const candidateSource = <T,>(query: { data: T | undefined; isError: boolean; error: unknown }): Source<T> =>
    Number.isNaN(completedId) ? idle : toSource(query)

  const analysis = session ? toSource(analysisQuery) : idle
  const missing = candidateSource(missingQuery)
  const disposal = candidateSource(disposalQuery)
  const evaluationRead = candidateSource({
    data: evaluationQuery.data?.summary,
    isError: evaluationQuery.isError,
    error: evaluationQuery.error,
  })
  // 상세 화면의 "더보기" 실패는 받아 둔 평가 현황에 영향이 없다.
  // 회차가 없다는 응답은 어느 페이지에서 받아도 우선하므로 ready가 아니라 여기에 해당하지 않는다.
  const nextPageOnly = evaluationQuery.isFetchNextPageError && evaluationRead.status === 'ready'
  const evaluation = nextPageOnly ? { ...evaluationRead, stale: false } : evaluationRead
  const shelves = toSource(shelvesQuery)

  const tracked: [label: string, query: TrackedQuery, failed: boolean][] = [
    ['서가 목록', shelvesQuery, shelvesQuery.isError],
    ['자동 분석 결과', analysisQuery, session !== null && analysisQuery.isError],
    ['소재불명 후보', missingQuery, !Number.isNaN(completedId) && missingQuery.isError],
    ['폐기 검토 후보', disposalQuery, !Number.isNaN(completedId) && disposalQuery.isError],
    ['가치평가 현황', evaluationQuery, !Number.isNaN(completedId) && evaluationQuery.isError && !nextPageOnly],
  ]
  const failures: (MapProblem & { busy: boolean })[] = [
    ...problems.map((problem) => ({ ...problem, busy: false })),
    ...tracked
      .filter(([, , failed]) => failed)
      .map(([label, query]) => ({
        label,
        stale: query.data !== undefined,
        busy: query.isFetching,
        retry: () => void query.refetch({ cancelRefetch: false }),
      })),
  ]

  if (shelves.status !== 'ready') {
    return shelves.status === 'loading' ? (
      <p className="shelf-map-state" role="status">
        서가 배치를 불러오는 중…
      </p>
    ) : (
      <div className="shelf-map-state" role="alert">
        <p>서가 배치를 불러오지 못했습니다.</p>
        <button
          type="button"
          className="scan-detail-btn"
          disabled={shelvesQuery.isFetching}
          onClick={() => void shelvesQuery.refetch({ cancelRefetch: false })}
        >
          다시 시도
        </button>
      </div>
    )
  }

  const model = buildShelfMapModel({ shelves, analysis, missing, disposal, evaluation })
  if (model.kind === 'sessionMissing') {
    return (
      <div className="shelf-map-state" role="alert">
        <p>장서점검 회차를 찾을 수 없습니다.</p>
        <button
          type="button"
          className="scan-detail-btn"
          onClick={() => {
            for (const [, query, failed] of tracked) if (failed) void query.refetch({ cancelRefetch: false })
            for (const problem of problems) problem.retry()
          }}
        >
          다시 시도
        </button>
      </div>
    )
  }

  const status: ShelfMapStatus = {
    analysis: analysis.status,
    missing: missing.status,
    disposal: disposal.status,
    evaluation: model.evaluation,
  }
  const loading = [analysis, missing, disposal, evaluation].some((source) => source.status === 'loading')

  return (
    <>
      <FailureNotice failures={failures} />
      {loading && (
        <p className="shelf-map-note" role="status">
          점검 결과를 불러오는 중…
        </p>
      )}
      <RoundNotes basis={basis} model={model} />
      <ShelfMapBoard model={model} status={status} />
    </>
  )
}

function FailureNotice({ failures }: { failures: (MapProblem & { busy: boolean })[] }) {
  if (failures.length === 0) return null
  const labels = (stale: boolean) =>
    failures
      .filter((failure) => failure.stale === stale)
      .map((failure) => failure.label)
      .join(', ')
  const busy = failures.some((failure) => failure.busy)

  return (
    <div className="shelf-map-alert" role="alert">
      <div>
        {labels(false) && <p>불러오지 못한 정보: {labels(false)}</p>}
        {labels(true) && <p>새로 불러오지 못해 이전 결과를 표시: {labels(true)}</p>}
      </div>
      <button type="button" className="scan-detail-btn" disabled={busy} onClick={() => failures.forEach((f) => f.retry())}>
        {busy ? '불러오는 중…' : '다시 시도'}
      </button>
    </div>
  )
}

/** 회차 전체에 해당하는 안내와, 배치도에 담지 못한 후보 */
function RoundNotes({ basis, model }: { basis: MapBasis; model: Extract<ShelfMapModel, { kind: 'map' }> }) {
  const notes: string[] = []
  if (basis.status === 'none') notes.push('점검 이력이 없어 서가 배치만 표시합니다.')
  if (basis.status === 'ready' && basis.session.status !== 'COMPLETED') {
    notes.push('확정 전 회차입니다. 소재불명·폐기 검토 후보는 확정 후 산출됩니다.')
  }

  for (const key of ['missing', 'disposal'] as const) {
    const off = model.offMap[key]
    if (!off) continue
    const parts = [off.outside > 0 && `다른 서가 ${off.outside}권`, off.unassigned > 0 && `서가 미지정 ${off.unassigned}권`]
    const text = parts.filter(Boolean).join(', ')
    if (text) notes.push(`배치도 밖의 ${MARKER_LABEL[key]}: ${text}`)
  }

  if (notes.length === 0) return null
  return (
    <ul className="shelf-map-notes">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  )
}

/** 층 선택, 범례, 위치 미등록 서가, 지도와 선택한 서가의 요약 */
function ShelfMapBoard({ model, status }: { model: Extract<ShelfMapModel, { kind: 'map' }>; status: ShelfMapStatus }) {
  const [floor, setFloor] = useState<number | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const placed: PlacedShelf[] = []
  for (const entry of model.entries) {
    const shape = entry.shelf && shelfShape(entry.shelf)
    if (shape) placed.push({ entry, shape, label: shelfAccessibleName(entry, status) })
  }
  const unplaced = model.entries.filter((entry) => !entry.placed)

  // 층마다 좌표를 따로 쓰므로 한 번에 한 층만 그린다. 낮은 층부터, 층 미등록은 마지막이다.
  const floors = [...new Set(placed.map((p) => p.entry.shelf!.floorNo))].sort(
    (a, b) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER),
  )
  const currentFloor = floor !== undefined && floors.includes(floor) ? floor : floors[0]
  const onFloor = placed.filter((p) => p.entry.shelf!.floorNo === currentFloor)
  const selected =
    [...onFloor.map((p) => p.entry), ...unplaced].find((entry) => entry.shelfId === selectedId) ?? null
  const summary = selected && <ShelfSummaryCard entry={selected} status={status} />

  return (
    <>
      {floors.length > 1 && (
        <div className="shelf-map-floors" role="group" aria-label="층 선택">
          {floors.map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={value === currentFloor}
              onClick={() => {
                setFloor(value)
                setSelectedId(null)
              }}
            >
              {formatFloor(value)}
            </button>
          ))}
        </div>
      )}

      <ul className="shelf-map-legend" aria-label="범례">
        {LEGEND_MARKERS.map((marker) => (
          <li key={marker}>
            <span className={`shelf-swatch shelf-swatch--${marker}`} aria-hidden="true" />
            {MARKER_LABEL[marker]}
          </li>
        ))}
        {model.entries.some((entry) => entry.inspection === 'notTargeted') && (
          <li>
            <span className="shelf-swatch shelf-swatch--inactive" aria-hidden="true" />
            대상 아님
          </li>
        )}
      </ul>

      {unplaced.length > 0 && (
        <div className="shelf-map-unplaced" role="group" aria-label="위치 미등록 서가">
          <span>위치 미등록</span>
          {unplaced.map((entry) => (
            <button
              key={entry.shelfId}
              type="button"
              aria-pressed={entry.shelfId === selectedId}
              aria-label={shelfAccessibleName(entry, status)}
              data-markers={entry.markers.join(' ')}
              onClick={() => setSelectedId(entry.shelfId === selectedId ? null : entry.shelfId)}
            >
              {entry.shelfCode}
              {entry.markers.map((marker) => (
                <span key={marker} className={`shelf-swatch shelf-swatch--${marker}`} aria-hidden="true" />
              ))}
            </button>
          ))}
        </div>
      )}

      <div className="shelf-map-area">
        <div className="shelf-map-card">
          {onFloor.length > 0 ? (
            <ShelfMapCanvas
              key={String(currentFloor)}
              shelves={onFloor}
              selectedId={selected?.shelfId ?? null}
              onSelect={setSelectedId}
            >
              {summary}
            </ShelfMapCanvas>
          ) : (
            <>
              <p className="shelf-map-empty">
                {model.entries.length === 0 ? '표시할 서가가 없습니다.' : '지도에 위치가 등록된 서가가 없습니다.'}
              </p>
              <div className="shelf-map-overlay">{summary}</div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** 배치도 헤더 우측: 도서 검색(준비 중)과 내 정보(준비 중) */
export function ShelfMapActions() {
  return (
    <div className="shelf-map-actions">
      <button type="button" className="shelf-map-search" disabled aria-label="도서 검색 (준비 중)">
        <SearchIcon size={20} />
      </button>
      <button type="button" className="pg-action" disabled aria-label="내 정보 (준비 중)">
        <UserIcon size={18} />
      </button>
    </div>
  )
}

/** 자료실 선택(또는 이름)과 기준 회차의 날짜 */
export function ShelfMapToolbar({ room, dateText }: { room: ReactNode; dateText: string }) {
  return (
    <div className="shelf-map-toolbar">
      {room}
      <p className="shelf-map-basis">{dateText}</p>
    </div>
  )
}
