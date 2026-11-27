// 사서 검토 조회 API(Backend Issue #16 / PR #22)와 회차 확정 API의 응답 타입.
// 필드명, 타입, nullable 여부는 Backend 코드(origin/main)의 record 정의를 따른다. null인 필드도 키는 항상 있다.
// 검토 결과는 자동 분석 결과(types/scan/analysis.ts)와 별도로 관리한다.
import type { ObservationStatusReason } from './analysis'
import type { PageResponse, ScanSessionStatus } from './api'

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

/** 회차 확정 결과의 건수 */
export interface FinalizeSummary {
  /** 위치가 확인되어 도서 원장에 반영한 도서 수 (자동 정상·오배치 + 사서의 도서 확정) */
  confirmedBooks: number
  /** 그중 마지막 확인 서가가 바뀐 도서 수 */
  locationChanged: number
  /** 소재불명이었다가 정상으로 되돌린 도서 수 */
  restoredFromMissing: number
  /** 식별 불가로 처리한 관측 수 */
  unidentified: number
  /** 점검 결과에서 제외한 관측 수 */
  excluded: number
  /** 새로 만든 소재불명 후보 수 */
  missingCandidates: number
}

/** POST /api/scan-sessions/{sessionId}/finalize */
export interface FinalizeResponse {
  sessionId: number
  status: ScanSessionStatus
  finalizedAt: string
  finalizedBy: number
  summary: FinalizeSummary
}

/** 쿼리 파라미터. reviewed를 생략하면 전체, page는 0부터, size는 기본 20(최대 100) */
export interface ReviewListParams {
  shelfId?: number
  reviewed?: boolean
  page?: number
  size?: number
}
