import type {
  AnalysisCounts,
  MatchedBook,
  ObservationBase,
  ObservationDetailResponse,
  ObservationStatusReason,
  ScanAnalysisResponse,
  ShelfObservationsResponse,
  ShelfScanInfo,
} from '@/types/scan/analysis'
import type { MockData, MockObservation, MockSessionShelf, MockShelf } from './types'

// 자동 분석 결과 조회 응답을 Mock 데이터에서 만든다. 건수, 후보 수, 중복 관측 목록, 서가의 관측 수와 촬영 시각은
// 저장하지 않고 호출할 때 관측에서 계산한다. 응답은 매번 새 객체라 바꿔도 저장소에 영향이 없다.
// 회차·서가·관측의 존재 확인과 오류 처리는 store.ts가 한다.

function countObservations(observations: readonly MockObservation[]): AnalysisCounts {
  const counts: AnalysisCounts = { total: observations.length, normal: 0, misplaced: 0, reviewRequired: 0 }
  for (const observation of observations) {
    if (observation.analysisStatus === 'NORMAL') counts.normal += 1
    else if (observation.analysisStatus === 'MISPLACED') counts.misplaced += 1
    else counts.reviewRequired += 1
  }
  return counts
}

function shelfCodeOf(data: MockData, shelfId: number | null): string | null {
  return data.shelves.find((shelf) => shelf.id === shelfId)?.shelfCode ?? null
}

function shelfOf(data: MockData, shelfId: number): MockShelf {
  const shelf = data.shelves.find((s) => s.id === shelfId)
  if (!shelf) throw new Error(`Mock 데이터에 없는 서가입니다: ${shelfId}`)
  return shelf
}

/** Backend의 서가 표시 순서(findShelves, ShelfService): displayOrder 오름차순(null은 뒤), 같으면 서가 ID 오름차순 */
export function compareShelves(a: MockShelf, b: MockShelf): number {
  if (a.displayOrder !== b.displayOrder) {
    if (a.displayOrder === null) return 1
    if (b.displayOrder === null) return -1
    return a.displayOrder - b.displayOrder
  }
  return a.id - b.id
}

/** Backend 저장 규칙: 수신 전에는 둘 다 null, 수신 후에는 관측 수와 detectedAt의 최댓값(시각이 없으면 null) */
function shelfScanInfo(data: MockData, link: MockSessionShelf, observations: readonly MockObservation[]): ShelfScanInfo {
  const shelf = shelfOf(data, link.shelfId)
  const received = link.scanStatus === 'RESULT_RECEIVED'
  // 타임존 없는 ISO 시각은 소수 초가 있거나 없어도 문자열 순서가 시간 순서와 같다. Date로 바꾸면 마이크로초가 사라진다.
  const detectedTimes = observations.flatMap((o) => (o.detectedAt === null ? [] : [o.detectedAt])).sort()
  return {
    shelfId: shelf.id,
    shelfCode: shelf.shelfCode,
    shelfWidthCm: shelf.widthCm,
    scanStatus: link.scanStatus,
    detectedBookCount: received ? observations.length : null,
    scannedAt: received ? (detectedTimes.at(-1) ?? null) : null,
  }
}

function matchedBook(data: MockData, bookId: number): MatchedBook {
  const book = data.books.find((b) => b.id === bookId)
  if (!book) throw new Error(`Mock 데이터에 없는 도서입니다: ${bookId}`)
  return {
    bookId: book.id,
    registrationNo: book.registrationNo,
    title: book.title,
    callNumber: book.callNumber,
    copyNumber: book.copyNumber,
    lifecycleStatus: book.lifecycleStatus,
    expectedShelfId: book.expectedShelfId,
    expectedShelfCode: shelfCodeOf(data, book.expectedShelfId),
    bookWidthCm: book.widthCm,
  }
}

function observationBase(data: MockData, o: MockObservation): ObservationBase {
  return {
    observationId: o.id,
    detectedOrder: o.detectedOrder,
    xPositionCm: o.xPositionCm,
    detectedLabelRaw: o.detectedLabelRaw,
    detectedTitle: o.detectedTitle,
    detectedClassificationNo: o.detectedClassificationNo,
    detectedBookSymbol: o.detectedBookSymbol,
    detectedCopyNumber: o.detectedCopyNumber,
    analysisStatus: o.analysisStatus,
    statusReason: o.statusReason,
    matchConfidence: o.matchConfidence,
    bookId: o.bookId,
    matchedBook: o.bookId === null ? null : matchedBook(data, o.bookId),
  }
}

export function buildAnalysis(data: MockData, session: ScanAnalysisResponse['session']): ScanAnalysisResponse {
  const observations = data.observations.filter((o) => o.sessionId === session.id)
  const reasonCounts: Partial<Record<ObservationStatusReason, number>> = {}
  for (const { statusReason } of observations) {
    if (statusReason !== null) reasonCounts[statusReason] = (reasonCounts[statusReason] ?? 0) + 1
  }
  const shelves = data.sessionShelves
    .filter((link) => link.sessionId === session.id)
    .sort((a, b) => compareShelves(shelfOf(data, a.shelfId), shelfOf(data, b.shelfId)))
    .map((link) => {
      const onShelf = observations.filter((o) => o.shelfId === link.shelfId)
      return { ...shelfScanInfo(data, link, onShelf), counts: countObservations(onShelf) }
    })
  return { session: { ...session }, counts: countObservations(observations), reasonCounts, shelves }
}

export function buildShelfObservations(data: MockData, link: MockSessionShelf): ShelfObservationsResponse {
  const onShelf = data.observations
    .filter((o) => o.sessionId === link.sessionId && o.shelfId === link.shelfId)
    .sort((a, b) => a.detectedOrder - b.detectedOrder || a.id - b.id)
  return {
    shelf: shelfScanInfo(data, link, onShelf),
    observations: onShelf.map((o) => ({ ...observationBase(data, o), candidateCount: o.candidates.length })),
  }
}

export function buildObservationDetail(data: MockData, observation: MockObservation): ObservationDetailResponse {
  const { id, sessionId, bookId, statusReason } = observation
  const duplicates =
    statusReason === 'DUPLICATE_OBSERVATION' && bookId !== null
      ? data.observations
          .filter((o) => o.sessionId === sessionId && o.bookId === bookId && o.id !== id)
          .sort((a, b) => a.shelfId - b.shelfId || a.detectedOrder - b.detectedOrder || a.id - b.id)
      : []
  return {
    ...observationBase(data, observation),
    detectedShelfId: observation.shelfId,
    detectedShelfCode: shelfCodeOf(data, observation.shelfId),
    detectedAt: observation.detectedAt,
    receivedAt: observation.receivedAt,
    candidates: [...observation.candidates]
      .sort((a, b) => a.rank - b.rank)
      .map((c) => ({ rank: c.rank, reason: c.reason, book: matchedBook(data, c.bookId) })),
    duplicateObservations: duplicates.map((o) => ({
      observationId: o.id,
      detectedShelfId: o.shelfId,
      detectedShelfCode: shelfCodeOf(data, o.shelfId),
      detectedOrder: o.detectedOrder,
    })),
  }
}
