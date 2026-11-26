// 자동 장서점검 분석 결과 조회 API(Backend Issue #9 / PR #21)의 DTO 타입.
// 필드명, 타입, nullable 여부는 Backend 코드(origin/main 723a3af)의 record 정의와 DB 스키마를 따른다.
// data 안의 값이 없는 필드는 생략되지 않고 null로 내려온다. LocalDateTime은 타임존 없는 ISO 문자열이다.
// 모든 값은 자동 분석 결과이며 사서의 검토 결과를 포함하지 않는다.
import type { ProcessingStage, ScanSessionStatus } from './api'

/** 서가의 결과 수신 상태. WAITING(수신 전)과 "수신했지만 관측 0건"은 다르다. */
export type ScanShelfStatus = 'WAITING' | 'RESULT_RECEIVED'

/** 자동 분석 상태. REVIEW_REQUIRED는 "인식 불가"가 아니라 사서의 확인이 필요하다는 뜻이다. (사유는 statusReason) */
export type ObservationAnalysisStatus = 'NORMAL' | 'MISPLACED' | 'REVIEW_REQUIRED'

/** 관측 상태의 대표 사유. NORMAL이면 null이고, 화면 문구는 Frontend가 정한다. */
export type ObservationStatusReason =
  | 'OCR_FAILED'
  | 'NO_MATCH'
  | 'AMBIGUOUS_MATCH'
  | 'WRONG_SHELF'
  | 'DUPLICATE_OBSERVATION'
  | 'DISPOSED_BOOK'
  | 'NO_EXPECTED_SHELF'

/** 매칭 후보를 고른 근거. 선언 순서가 우선순위다. */
export type CandidateReason = 'EXACT_MATCH' | 'COPY_MISMATCH' | 'SYMBOL_ONLY' | 'CLASSIFICATION_ONLY'

/** 도서 생애 상태: 정상 / 소재불명 / 훼손 / 제적 */
export type BookLifecycleStatus = 'NORMAL' | 'MISSING' | 'DAMAGED' | 'DISPOSED'

/** total = normal + misplaced + reviewRequired */
export interface AnalysisCounts {
  total: number
  normal: number
  misplaced: number
  reviewRequired: number
}

export interface ShelfScanInfo {
  shelfId: number
  shelfCode: string
  shelfWidthCm: number | null
  scanStatus: ScanShelfStatus
  /** 수신 전에는 null, 수신했고 관측이 없으면 0 */
  detectedBookCount: number | null
  /** 촬영 시각(관측 detectedAt의 최댓값). 수신 전, 관측 0건, 시각이 있는 관측이 없는 서가는 null */
  scannedAt: string | null
}

export interface ShelfAnalysis extends ShelfScanInfo {
  counts: AnalysisCounts
}

/** GET /api/scan-sessions/{sessionId}/analysis */
export interface ScanAnalysisResponse {
  session: {
    id: number
    status: ScanSessionStatus
    processingStage: ProcessingStage
  }
  counts: AnalysisCounts
  /** 사유가 있는 관측의 사유별 건수. 값이 있는 사유의 키만 있다. */
  reasonCounts: Partial<Record<ObservationStatusReason, number>>
  /** 회차의 점검 대상 서가 전부(관측이 없는 서가 포함) */
  shelves: ShelfAnalysis[]
}

/** 관측에 연결된 도서(자동 매칭 도서 또는 후보 도서). 도서 원장의 현재 값이다. */
export interface MatchedBook {
  bookId: number
  registrationNo: string
  title: string
  callNumber: string
  copyNumber: string | null
  lifecycleStatus: BookLifecycleStatus
  expectedShelfId: number | null
  expectedShelfCode: string | null
  bookWidthCm: number | null
}

/** 서가 목록과 상세가 공통으로 가지는 관측 필드 */
export interface ObservationBase {
  observationId: number
  /** 서가 안의 인식 순서 */
  detectedOrder: number
  xPositionCm: number | null
  detectedLabelRaw: string | null
  detectedTitle: string | null
  /** 파싱값. OCR 원문 매칭으로 만든 관측은 도서를 식별해도 null이다. */
  detectedClassificationNo: string | null
  detectedBookSymbol: string | null
  detectedCopyNumber: string | null
  analysisStatus: ObservationAnalysisStatus
  statusReason: ObservationStatusReason | null
  /** 도서를 식별한 경우에만 값이 있다. (0 초과 1 이하) */
  matchConfidence: number | null
  /** 자동 식별한 도서. 검토 필요여도 식별되었다면 유지한다. */
  bookId: number | null
  matchedBook: MatchedBook | null
}

export interface ObservationItem extends ObservationBase {
  candidateCount: number
}

/** GET /api/scan-sessions/{sessionId}/shelves/{shelfId}/observations. 페이지네이션 없이 전체를 돌려준다. */
export interface ShelfObservationsResponse {
  shelf: ShelfScanInfo
  /** detectedOrder, observationId 오름차순 */
  observations: ObservationItem[]
}

export interface ObservationCandidate {
  /** 1부터 시작, 최대 3 */
  rank: number
  /** DB 컬럼이 NULL을 허용한다. */
  reason: CandidateReason | null
  book: MatchedBook
}

/** 같은 회차에서 같은 도서로 식별된 다른 관측 */
export interface DuplicateObservation {
  observationId: number
  detectedShelfId: number | null
  detectedShelfCode: string | null
  detectedOrder: number
}

/** GET /api/scan-sessions/{sessionId}/observations/{observationId} */
export interface ObservationDetailResponse extends ObservationBase {
  detectedShelfId: number | null
  detectedShelfCode: string | null
  detectedAt: string | null
  receivedAt: string
  /** rank 오름차순 */
  candidates: ObservationCandidate[]
  /** statusReason이 DUPLICATE_OBSERVATION일 때만 값이 있다. 자신은 제외한다. */
  duplicateObservations: DuplicateObservation[]
}
