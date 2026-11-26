// 사서 검토 조회 API(Backend Issue #16 / PR #22)의 응답 타입.
// 필드명, 타입, nullable 여부는 Backend 코드(origin/main)의 record 정의를 따른다. null인 필드도 키는 항상 있다.
// 검토 결과는 자동 분석 결과(types/scan/analysis.ts)와 별도로 관리한다.
import type { ObservationStatusReason } from './analysis'
import type { PageResponse } from './api'

/** 검토 조치: 도서 확정 / 식별 불가 / 점검 결과에서 제외 */
export type ReviewAction = 'IDENTIFY_BOOK' | 'MARK_UNIDENTIFIED' | 'EXCLUDE'

/** 검토 후의 최종 판정. 서버가 조치와 도서·서가 정보로 계산한다. */
export type ReviewFinalStatus = 'NORMAL' | 'MISPLACED' | 'UNIDENTIFIED' | 'EXCLUDED'

/** 검토 화면에서 도서를 알아보는 최소 정보. 도서 원장의 현재 값이다. */
export interface BookBrief {
  bookId: number
  registrationNo: string
  title: string
  callNumber: string
}

export interface ReviewResult {
  reviewId: number
  action: ReviewAction
  finalStatus: ReviewFinalStatus
  /** 도서를 확정한 검토에만 있다. */
  finalBook: BookBrief | null
  comment: string | null
  reviewerId: number
  reviewerName: string | null
  reviewedAt: string
}

/** 회차 전체의 집계. 서가·검토 여부 필터와 페이지에 영향받지 않는다. */
export interface ReviewSummary {
  totalRequired: number
  reviewed: number
  remaining: number
}

/** 검토 대상(자동 분석이 REVIEW_REQUIRED인 관측) 한 건 */
export interface ReviewItem {
  observationId: number
  shelfId: number | null
  shelfCode: string | null
  detectedOrder: number
  detectedLabelRaw: string | null
  detectedTitle: string | null
  statusReason: ObservationStatusReason | null
  /** 자동 매칭된 도서가 없으면 null */
  autoMatchedBook: BookBrief | null
  candidateCount: number
  /** 아직 검토하지 않았으면 null */
  review: ReviewResult | null
}

/** GET /api/scan-sessions/{sessionId}/reviews */
export interface ReviewListResponse {
  summary: ReviewSummary
  items: PageResponse<ReviewItem>
}

/** 쿼리 파라미터. reviewed를 생략하면 전체, page는 0부터, size는 기본 20(최대 100) */
export interface ReviewListParams {
  shelfId?: number
  reviewed?: boolean
  page?: number
  size?: number
}
