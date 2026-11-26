import type { ScanSessionStatus } from '@/types/scan/api'

/** 상태 필터를 정렬·중복 제거한다. 순서만 다른 필터가 서로 다른 캐시가 되지 않도록 한다. 없거나 비어 있으면 "전체"다. */
export function normalizeStatuses(statuses?: readonly ScanSessionStatus[]): ScanSessionStatus[] {
  return [...new Set(statuses ?? [])].sort()
}

/** 분석 결과 조회는 모든 ID가 양의 안전한 정수일 때만 요청한다. 라우트나 선택 값이 없으면(NaN 등) 요청하지 않는다. */
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
}
