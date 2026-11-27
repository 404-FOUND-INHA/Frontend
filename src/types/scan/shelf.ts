// 서가 조회 API(GET /api/shelves)의 DTO 타입. 필드명, 타입, nullable 여부는 Backend 코드(origin/main)의 ShelfResponse를
// 따른다. BigDecimal(좌표, 크기, 회전)은 JSON 숫자다.

export interface ShelfResponse {
  id: number
  shelfCode: string
  /** 자료실 */
  zone: string | null
  floorNo: number | null
  shelfNo: number | null
  levelNo: number | null
  callNumberStart: string | null
  callNumberEnd: string | null
  markerId: string | null
  /** 지도 좌표. 단위, 기준점, 축 방향은 API 계약에 정해져 있지 않다. */
  mapX: number | null
  mapY: number | null
  mapZ: number | null
  widthCm: number | null
  heightCm: number | null
  depthCm: number | null
  /** 지도상 방향 (0~360) */
  rotationDegree: number | null
  displayOrder: number | null
  active: boolean
  /** 현재 서가가 이 서가인 도서 수 */
  bookCount: number
  createdAt: string
  updatedAt: string
}

/** 쿼리 파라미터. zone을 생략하거나 공백이면 전체 자료실이고, 기본은 사용 중 서가만이다. 정렬은 표시 순서(없으면 뒤) → ID. */
export interface ShelfListParams {
  zone?: string
  includeInactive?: boolean
}
