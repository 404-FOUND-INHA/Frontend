// 폐기 검토 후보 조회 API(GET /api/scan-sessions/{sessionId}/disposal-candidates)의 DTO 타입.
// 필드명, 타입, nullable 여부는 Backend 코드(origin/main)의 EvaluationListResponse, EvaluationItem, ShelfInfo를 따른다.
// BigDecimal(점수, 지도 좌표)은 JSON 숫자다.
import type { PageResponse } from './api'

/**
 * 회차의 종합 평가 판정. Backend CandidateStatus의 UNDECIDED는 JEV 원본 결과에만 있고 종합 평가 응답에는 없다.
 * NOT_EVALUABLE은 점수가 없는 평가축이 있어 판정하지 못한 도서이며 폐기 검토 후보가 아니다.
 */
export type CompositeCandidateStatus = 'KEEP' | 'DISPOSAL_REVIEW' | 'NOT_EVALUABLE'

/** 도서의 현재 서가 위치. 서가 코드 외의 값은 서가에 등록되지 않았으면 null이다. */
export interface ShelfInfo {
  shelfId: number
  shelfCode: string
  zone: string | null
  floorNo: number | null
  shelfNo: number | null
  levelNo: number | null
  mapX: number | null
  mapY: number | null
  mapZ: number | null
}

export interface EvaluationItem {
  evaluationId: number
  bookId: number
  title: string
  registrationNo: string
  callNumber: string
  /** 종합 점수(0~100, 소수 둘째 자리). 높을수록 폐기 검토 필요성이 크다. 평가 불가이면 null */
  finalScore: number | null
  candidateStatus: CompositeCandidateStatus
  /** 계산에 쓴 평가 설정 버전. 저장된 설정이 없으면 "default" */
  profileVersion: string
  evaluatedAt: string
  /** 현재 서가가 지정되지 않은 도서는 null */
  shelf: ShelfInfo | null
}

/** 필터와 페이지에 상관없이 회차 전체를 센다. total은 종합 평가가 저장된 도서 수다. */
export interface EvaluationSummary {
  total: number
  disposalReview: number
  keep: number
  notEvaluable: number
}

/** 목록 필드의 이름은 page다. 점수 내림차순, 같으면 도서 ID 오름차순이다. */
export interface EvaluationListResponse {
  summary: EvaluationSummary
  page: PageResponse<EvaluationItem>
}

/** 쿼리 파라미터. page는 0부터이고 size는 1~100으로 보정된다. */
export interface DisposalCandidateListParams {
  page?: number
  size?: number
}
