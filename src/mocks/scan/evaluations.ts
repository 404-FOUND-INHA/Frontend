import type {
  CompositeCandidateStatus,
  EvaluationItem,
  EvaluationListResponse,
  ShelfCandidateGroup,
  ShelfCandidatesResponse,
  ShelfInfo,
} from '@/types/scan/evaluation'
import type { MockData, MockEvaluation } from './types'

// 폐기 검토 후보 조회 응답을 Mock 데이터에서 만든다(Backend EvaluationQueryService.disposalCandidates, candidatesByShelf).
// 저장된 판정과 점수를 그대로 읽고, 도서 정보와 서가는 현재 원장의 값이다. 입력 검증과 회차 확인은 store.ts가 한다.

/** 보정을 마친 조회 조건 */
export interface DisposalCandidateQuery {
  page: number
  size: number
}

/** 현재 서가. Mock 서가에 없는 값(서가·단 번호, mapZ)은 null이다. */
function shelfInfo(data: MockData, shelfId: number | null): ShelfInfo | null {
  if (shelfId === null) return null
  const shelf = data.shelves.find((s) => s.id === shelfId)
  if (!shelf) throw new Error(`Mock 데이터에 없는 서가입니다: ${shelfId}`)
  return {
    shelfId: shelf.id,
    shelfCode: shelf.shelfCode,
    zone: shelf.zone,
    floorNo: shelf.floorNo,
    shelfNo: null,
    levelNo: null,
    mapX: shelf.mapX,
    mapY: shelf.mapY,
    mapZ: null,
  }
}

function toItem(data: MockData, e: MockEvaluation): EvaluationItem {
  const book = data.books.find((b) => b.id === e.bookId)
  if (!book) throw new Error(`Mock 데이터에 없는 도서입니다: ${e.bookId}`)
  return {
    evaluationId: e.id,
    bookId: book.id,
    title: book.title,
    registrationNo: book.registrationNo,
    callNumber: book.callNumber,
    finalScore: e.finalScore,
    candidateStatus: e.candidateStatus,
    profileVersion: e.profileVersion,
    evaluatedAt: e.evaluatedAt,
    shelf: shelfInfo(data, book.currentShelfId),
  }
}

/** 회차의 폐기 검토 후보 전체. 점수가 높은 순이고, 같으면 도서 ID 순이다. */
function disposalCandidatesOf(evaluations: readonly MockEvaluation[]): MockEvaluation[] {
  return evaluations
    .filter((e) => e.candidateStatus === 'DISPOSAL_REVIEW')
    .sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1) || a.bookId - b.bookId)
}

/** 회차 전체의 평가 현황과 폐기 검토 후보 한 페이지. */
export function buildDisposalCandidates(
  data: MockData,
  sessionId: number,
  { page, size }: DisposalCandidateQuery,
): EvaluationListResponse {
  const evaluations = data.evaluations.filter((e) => e.sessionId === sessionId)
  const count = (status: CompositeCandidateStatus) => evaluations.filter((e) => e.candidateStatus === status).length
  const candidates = disposalCandidatesOf(evaluations)
  return {
    summary: {
      total: evaluations.length,
      disposalReview: candidates.length,
      keep: count('KEEP'),
      notEvaluable: count('NOT_EVALUABLE'),
    },
    page: {
      content: candidates.slice(page * size, page * size + size).map((e) => toItem(data, e)),
      page,
      size,
      totalElements: candidates.length,
      totalPages: Math.ceil(candidates.length / size),
    },
  }
}

/** 회차의 폐기 검토 후보를 도서의 현재 서가로 묶는다. 후보 수가 많은 순, 같으면 서가 코드 순이고 서가 미지정은 마지막이다. */
export function buildDisposalCandidatesByShelf(data: MockData, sessionId: number): ShelfCandidatesResponse {
  const items = disposalCandidatesOf(data.evaluations.filter((e) => e.sessionId === sessionId)).map((e) => toItem(data, e))
  const groups = new Map<number | null, ShelfCandidateGroup>()
  for (const { shelf, bookId, title, callNumber, finalScore } of items) {
    const key = shelf?.shelfId ?? null
    // 후보를 점수 순으로 담으므로 처음 담는 도서의 점수가 서가의 최고 점수다.
    const group = groups.get(key) ?? { shelf, candidateCount: 0, maxScore: finalScore, books: [] }
    group.books.push({ bookId, title, callNumber, finalScore })
    group.candidateCount += 1
    groups.set(key, group)
  }
  const code = (group: ShelfCandidateGroup) => group.shelf?.shelfCode ?? ''
  return {
    totalCandidates: items.length,
    shelves: [...groups.values()].sort(
      (a, b) =>
        Number(a.shelf === null) - Number(b.shelf === null) ||
        b.candidateCount - a.candidateCount ||
        (code(a) < code(b) ? -1 : code(a) > code(b) ? 1 : 0),
    ),
  }
}
