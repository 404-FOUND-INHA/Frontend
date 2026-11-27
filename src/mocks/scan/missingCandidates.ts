import type { PageResponse } from '@/types/scan/api'
import type { MissingCandidateResponse, MissingCandidateStatus } from '@/types/scan/missingCandidate'
import { bookBrief } from './review'
import type { MockData, MockMissingCandidate } from './types'

// 소재불명 후보 조회 응답을 Mock 데이터에서 만든다(Backend MissingCandidateService.list).
// 후보는 회차 확정(finalize.ts)이나 시드가 저장한 것을 그대로 읽는다. 입력 검증과 회차 확인은 store.ts가 한다.

/** 보정을 마친 조회 조건 */
export interface MissingCandidateQuery {
  status?: MissingCandidateStatus
  page: number
  size: number
}

function toResponse(data: MockData, c: MockMissingCandidate): MissingCandidateResponse {
  return {
    candidateId: c.id,
    book: bookBrief(data, c.bookId),
    expectedShelfId: c.expectedShelfId,
    expectedShelfCode: data.shelves.find((s) => s.id === c.expectedShelfId)?.shelfCode ?? null,
    consecutiveMissingCount: c.consecutiveMissingCount,
    status: c.status,
    reviewedBy: c.reviewedBy,
    reviewedAt: c.reviewedAt,
    note: c.note,
    createdAt: c.createdAt,
  }
}

/** 회차의 후보 한 페이지. 연속 미발견 횟수가 많은 순이고, 같으면 후보 ID 순이다. */
export function buildMissingCandidatePage(
  data: MockData,
  sessionId: number,
  { status, page, size }: MissingCandidateQuery,
): PageResponse<MissingCandidateResponse> {
  const matched = data.missingCandidates
    .filter((c) => c.sessionId === sessionId && (status === undefined || c.status === status))
    .sort((a, b) => b.consecutiveMissingCount - a.consecutiveMissingCount || a.id - b.id)
  return {
    content: matched.slice(page * size, page * size + size).map((c) => toResponse(data, c)),
    page,
    size,
    totalElements: matched.length,
    totalPages: Math.ceil(matched.length / size),
  }
}
