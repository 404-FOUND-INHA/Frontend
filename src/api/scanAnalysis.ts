import { getScanStore } from '@/mocks/scan/store'
import type { ObservationDetailResponse, ScanAnalysisResponse, ShelfObservationsResponse } from '@/types/scan/analysis'
import { simulateLatency } from './scanSessions'

// 자동 분석 결과 데이터 접근 계층. scanSessions.ts와 같은 규칙을 따른다: 지금은 Mock 저장소만 사용하고,
// 반환 타입은 실제 API의 data와 같으며, 실패하면 저장소의 ApiError를 그대로 전달한다.
// 건수 등 모든 값은 응답을 그대로 쓰고 여기서 다시 계산하지 않는다.

/** GET /api/scan-sessions/{sessionId}/analysis */
export async function getScanAnalysis(sessionId: number): Promise<ScanAnalysisResponse> {
  await simulateLatency()
  return getScanStore().getAnalysis(sessionId)
}

/** GET /api/scan-sessions/{sessionId}/shelves/{shelfId}/observations */
export async function getShelfObservations(sessionId: number, shelfId: number): Promise<ShelfObservationsResponse> {
  await simulateLatency()
  return getScanStore().getShelfObservations(sessionId, shelfId)
}

/** GET /api/scan-sessions/{sessionId}/observations/{observationId} */
export async function getObservationDetail(sessionId: number, observationId: number): Promise<ObservationDetailResponse> {
  await simulateLatency()
  return getScanStore().getObservation(sessionId, observationId)
}
