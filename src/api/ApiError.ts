import type { ErrorResponse, FieldError } from '@/types/scan/api'

/** Backend ErrorCode 중 장서점검 A1에서 사용하는 코드 */
export const ERROR_CODE = {
  INVALID_INPUT: 'COMMON_001',
  FORBIDDEN: 'COMMON_005',
  SCAN_SESSION_NOT_FOUND: 'SCAN_001',
  SCAN_SESSION_ALREADY_OPEN: 'SCAN_002',
  SCAN_NO_ACTIVE_SHELF: 'SCAN_003',
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
