// Backend A1 API(장서점검 회차 생성·조회, Issue #7 / PR #8)의 DTO 타입.
// 필드명, 타입, nullable 여부는 Backend 코드(origin/main)의 record 정의와 Jackson 직렬화 규칙을 따른다.
// UI 편의를 위한 필드는 추가하지 않는다.

export type ScanSessionStatus = 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED'

// 저장되지 않고 status에서 계산된다. ANALYZING은 Backend에서 현재 반환하지 않는다.
export type ProcessingStage = 'VISION_WAITING' | 'ANALYZING' | 'ANALYSIS_DONE'

/** 회차 생성·목록·상세 공용 응답 (ScanSessionResponse). LocalDateTime은 타임존 없는 ISO 문자열이다. */
export interface ScanSessionResponse {
  id: number
  sessionName: string
  status: ScanSessionStatus
  processingStage: ProcessingStage
  zone: string | null
  /** 회차 대상 서가 층의 최솟값. 층 정보가 없으면 null */
  floorNo: number | null
  /** 'YYYY-MM-DD' */
  plannedStartDate: string | null
  /** 회차 생성 시 설정된다. createdAt과 같은 값이라고 보장되지는 않는다 (Mock만 같게 만든다). */
  startedAt: string | null
  /** 결과가 확정(COMPLETED)된 시각. 그 전에는 null */
  finalizedAt: string | null
  createdAt: string
}

/** 점검 대상으로 고를 수 있는 자료실 (ScanRoomResponse). hasOpenSession이 true이면 새 회차를 만들 수 없다. */
export interface ScanRoomResponse {
  zone: string
  floorNo: number | null
  shelfCount: number
  hasOpenSession: boolean
}

/** POST /api/scan-sessions 요청 본문. plannedStartDate는 생략하거나 null이어도 된다. */
export interface ScanSessionCreateRequest {
  sessionName: string
  zone: string
  /** 'YYYY-MM-DD', 서울 기준 오늘 이후만 허용 */
  plannedStartDate?: string | null
}

/** GET /api/scan-sessions 쿼리 파라미터. status는 반복 지정, page는 0부터 시작한다. */
export interface ScanSessionListParams {
  status?: readonly ScanSessionStatus[]
  page?: number
  size?: number
}

/** 목록 응답 (PageResponse). page는 0부터 시작한다. */
export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

/**
 * 성공 응답 봉투 (ApiResponse). Backend는 @JsonInclude(NON_NULL)이라 data가 null이면 키가 생략된다.
 * 데이터 접근 함수는 이 봉투를 벗긴 data만 UI에 전달한다. (실제 HTTP 구현 시 사용)
 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
}

export interface FieldError {
  field: string
  /** Spring 검증 기본 문구라 계약이 아니다. 화면에 그대로 노출하지 않는다. */
  reason: string
}

/** 실패 응답 (ErrorResponse). 성공 봉투와 달리 success 필드가 없고 errors는 항상 배열이다. */
export interface ErrorResponse {
  code: string
  message: string
  errors: FieldError[]
}
