import type { ErrorResponse, FieldError } from '@/types/scan/api'

/** Backend ErrorCode 중 장서점검 회차, 분석·검토 조회, 회차 확정, 평가 설정에서 사용하는 코드 */
export const ERROR_CODE = {
  INVALID_INPUT: 'COMMON_001',
  FORBIDDEN: 'COMMON_005',
  SCAN_SESSION_NOT_FOUND: 'SCAN_001',
  SCAN_SESSION_ALREADY_OPEN: 'SCAN_002',
  SCAN_NO_ACTIVE_SHELF: 'SCAN_003',
  SCAN_SHELF_NOT_IN_SESSION: 'SCAN_007',
  SCAN_OBSERVATION_NOT_FOUND: 'SCAN_008',
  SCAN_SESSION_NOT_FINALIZABLE: 'SCAN_009',
  SCAN_REVIEW_INCOMPLETE: 'SCAN_010',
  EVALUATION_INVALID_WEIGHTS: 'EVAL_001',
  INTERNAL_SERVER_ERROR: 'COMMON_999',
} as const

/** 상태 코드와 Backend 에러 코드를 함께 확인할 수 있는 API 오류. Mock과 이후 HTTP 구현이 같은 형태로 던진다. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly errors: FieldError[]

  constructor(status: number, body: ErrorResponse) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.errors = body.errors
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
