import type { BookBrief, ReviewItem, ReviewListResponse, ReviewResult, ReviewSummary } from '@/types/scan/review'
import type { MockData, MockObservation, MockReview } from './types'

// 사서 검토 조회 응답을 Mock 데이터에서 만든다. 집계는 저장하지 않고 호출할 때 관측과 검토 기록에서 계산한다.
// 응답은 매번 새 객체라 바꿔도 저장소에 영향이 없다. 입력 검증과 회차 확인은 store.ts가 한다.

/** 보정을 마친 조회 조건 */
export interface ReviewQuery {
  shelfId?: number
  reviewed?: boolean
  page: number
  size: number
}

function bookBrief(data: MockData, bookId: number): BookBrief {
  const book = data.books.find((b) => b.id === bookId)
  if (!book) throw new Error(`Mock 데이터에 없는 도서입니다: ${bookId}`)
  return { bookId: book.id, registrationNo: book.registrationNo, title: book.title, callNumber: book.callNumber }
}

function reviewResult(data: MockData, review: MockReview): ReviewResult {
  return {
    reviewId: review.id,
    action: review.action,
    finalStatus: review.finalStatus,
    finalBook: review.finalBookId === null ? null : bookBrief(data, review.finalBookId),
    comment: review.comment,
    reviewerId: review.reviewerId,
    reviewerName: data.users.find((u) => u.id === review.reviewerId)?.name ?? null,
    reviewedAt: review.reviewedAt,
  }
}

function reviewItem(data: MockData, o: MockObservation, review: MockReview | undefined): ReviewItem {
  return {
    observationId: o.id,
    shelfId: o.shelfId,
    shelfCode: data.shelves.find((s) => s.id === o.shelfId)?.shelfCode ?? null,
    detectedOrder: o.detectedOrder,
    detectedLabelRaw: o.detectedLabelRaw,
    detectedTitle: o.detectedTitle,
    statusReason: o.statusReason,
    autoMatchedBook: o.bookId === null ? null : bookBrief(data, o.bookId),
    candidateCount: o.candidates.length,
    review: review ? reviewResult(data, review) : null,
  }
}

/**
 * 회차의 검토 대상(REVIEW_REQUIRED 관측)과 각 검토 기록. 서가 ID → 배치 순서 → 관측 ID 순이다.
 * (분석 요약의 서가 정렬과 달리 displayOrder를 쓰지 않는다: Backend ReviewQueryRepository)
 */
function requiredReviews(data: MockData, sessionId: number) {
  const reviewsByObservation = new Map(data.reviews.map((r) => [r.observationId, r]))
  return data.observations
    .filter((o) => o.sessionId === sessionId && o.analysisStatus === 'REVIEW_REQUIRED')
    .sort((a, b) => a.shelfId - b.shelfId || a.detectedOrder - b.detectedOrder || a.id - b.id)
    .map((observation) => ({ observation, review: reviewsByObservation.get(observation.id) }))
}

/** 검토 기록이 있으면 판정과 관계없이(식별 불가·제외 포함) 검토 완료다. */
function summarize(rows: readonly { review: MockReview | undefined }[]): ReviewSummary {
  const reviewed = rows.filter((row) => row.review !== undefined).length
  return { totalRequired: rows.length, reviewed, remaining: rows.length - reviewed }
}

export function buildReviewList(data: MockData, sessionId: number, query: ReviewQuery): ReviewListResponse {
  const rows = requiredReviews(data, sessionId)
  const filtered = rows.filter(
    ({ observation, review }) =>
      (query.shelfId === undefined || observation.shelfId === query.shelfId) &&
      (query.reviewed === undefined || (review !== undefined) === query.reviewed),
  )
  const { page, size } = query
  return {
    summary: summarize(rows), // 필터를 적용하기 전의 회차 전체
    items: {
      content: filtered.slice(page * size, page * size + size).map((row) => reviewItem(data, row.observation, row.review)),
      page,
      size,
      totalElements: filtered.length,
      totalPages: Math.ceil(filtered.length / size),
    },
  }
}
