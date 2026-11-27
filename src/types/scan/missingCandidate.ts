// 소재불명 후보 조회 API(GET /api/scan-sessions/{sessionId}/missing-candidates)의 DTO 타입.
// 필드명, 타입, nullable 여부는 Backend 코드(origin/main)의 MissingCandidateResponse와 MissingCandidateStatus를 따른다.
// 목록은 PageResponse이며 연속 미발견 횟수 내림차순, 후보 ID 오름차순이다.
import type { BookBrief } from './review'

/**
 * 현장 확인 상태. 후보는 PENDING(확인 전)으로 생성되고, 확인 결과를 기록하면 나머지 값이 된다.
 * FOUND(찾음)와 RESOLVED(종결)는 연속 미발견 횟수를 이어 가지 않는다.
 */
export type MissingCandidateStatus = 'PENDING' | 'FOUND' | 'NOT_FOUND' | 'LOST_CANDIDATE' | 'RESOLVED'

export interface MissingCandidateResponse {
  candidateId: number
  /** 도서 정보는 현재 원장의 값이다. */
  book: BookBrief
  /** 후보를 만든 시점의 정상 배치 서가 */
  expectedShelfId: number | null
  expectedShelfCode: string | null
  /** 같은 서가를 연이어 점검하는 동안 발견하지 못한 횟수 (1 이상) */
  consecutiveMissingCount: number
  status: MissingCandidateStatus
  /** 확인 기록. PENDING이면 모두 null이고, 메모는 확인한 뒤에도 없을 수 있다. */
  reviewedBy: number | null
  reviewedAt: string | null
  note: string | null
  /** 회차 확정 시각 */
  createdAt: string
}

/** 쿼리 파라미터. status를 생략하면 전체, page는 0부터이고 size는 1~100으로 보정된다. */
export interface MissingCandidateListParams {
  status?: MissingCandidateStatus
  page?: number
  size?: number
}
