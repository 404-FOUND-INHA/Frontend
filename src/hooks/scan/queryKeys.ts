import type { ScanSessionStatus } from '@/types/scan/api'
import type { MissingCandidateListParams } from '@/types/scan/missingCandidate'
import type { ReviewListParams } from '@/types/scan/review'

export const SCAN_REVIEWS_PAGE_SIZE = 20

/** 상태 필터를 정렬·중복 제거한다. 순서만 다른 필터가 서로 다른 캐시가 되지 않도록 한다. 없거나 비어 있으면 "전체"다. */
export function normalizeStatuses(statuses?: readonly ScanSessionStatus[]): ScanSessionStatus[] {
  return [...new Set(statuses ?? [])].sort()
}

/** 검토 조회 조건. 생략한 page·size를 기본값으로 채워 같은 요청이 같은 캐시를 쓴다. 생략한 필터는 "전체"다. */
export function normalizeReviewParams({ shelfId, reviewed, page = 0, size = SCAN_REVIEWS_PAGE_SIZE }: ReviewListParams = {}) {
  return { shelfId, reviewed, page, size }
}

export const SCAN_CANDIDATES_PAGE_SIZE = 20

/** 후보 목록의 조회 조건. 페이지 번호는 무한 조회가 정하므로 키에 넣지 않는다. 생략한 상태 필터는 "전체"다. */
export function normalizeMissingCandidateParams({
  status,
  size = SCAN_CANDIDATES_PAGE_SIZE,
}: Omit<MissingCandidateListParams, 'page'> = {}) {
  return { status, size }
}

/** 분석 결과, 검토, 후보 조회는 모든 ID가 양의 안전한 정수일 때만 요청한다. 라우트나 선택 값이 없으면(NaN 등) 요청하지 않는다. */
export function isRequestableId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0
}

export const scanKeys = {
  rooms: () => ['scan', 'rooms'] as const,
  /** 모든 상태 필터와 페이지 크기의 목록 캐시를 가리키는 접두사 (무효화용) */
  sessionLists: () => ['scan', 'sessions', 'list'] as const,
  sessionList: (statuses: readonly ScanSessionStatus[] | undefined, size: number) =>
    ['scan', 'sessions', 'list', { status: normalizeStatuses(statuses), size }] as const,
  session: (id: number) => ['scan', 'session', id] as const,
  analysis: (sessionId: number) => ['scan', 'analysis', sessionId] as const,
  shelfObservations: (sessionId: number, shelfId: number) => ['scan', 'shelfObservations', sessionId, shelfId] as const,
  observation: (sessionId: number, observationId: number) => ['scan', 'observation', sessionId, observationId] as const,
  /** 모든 회차의 관측 목록·상세를 가리키는 접두사 (무효화용) */
  allShelfObservations: () => ['scan', 'shelfObservations'] as const,
  allObservations: () => ['scan', 'observation'] as const,
  /** 한 회차의 모든 필터·페이지의 검토 조회를 가리키는 접두사 (무효화용) */
  sessionReviews: (sessionId: number) => ['scan', 'reviews', sessionId] as const,
  reviews: (sessionId: number, params?: ReviewListParams) =>
    ['scan', 'reviews', sessionId, normalizeReviewParams(params)] as const,
  /** 한 회차의 모든 조건의 소재불명 후보 조회를 가리키는 접두사 (무효화용) */
  sessionMissingCandidates: (sessionId: number) => ['scan', 'missingCandidates', sessionId] as const,
  missingCandidates: (sessionId: number, params?: Omit<MissingCandidateListParams, 'page'>) =>
    ['scan', 'missingCandidates', sessionId, normalizeMissingCandidateParams(params)] as const,
  /** 모든 회차의 폐기 검토 후보 조회를 가리키는 접두사 (무효화용) */
  allDisposalCandidates: () => ['scan', 'disposalCandidates'] as const,
  disposalCandidates: (sessionId: number, size: number = SCAN_CANDIDATES_PAGE_SIZE) =>
    ['scan', 'disposalCandidates', sessionId, { size }] as const,
  /** 회차 확정 mutation */
  finalize: (sessionId: number) => ['scan', 'finalize', sessionId] as const,
}
