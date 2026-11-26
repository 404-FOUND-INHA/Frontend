import { getScanStore } from '@/mocks/scan/store'
import type { ReviewListParams, ReviewListResponse } from '@/types/scan/review'
import { simulateLatency } from './scanSessions'

// 사서 검토 데이터 접근 계층. scanSessions.ts와 같은 규칙을 따른다: 지금은 Mock 저장소만 사용하고,
// 반환 타입은 실제 API의 data와 같으며, 실패하면 저장소의 ApiError를 그대로 전달한다.

/** GET /api/scan-sessions/{sessionId}/reviews */
export async function getScanReviews(sessionId: number, params: ReviewListParams = {}): Promise<ReviewListResponse> {
  await simulateLatency()
  return getScanStore().getReviews(sessionId, params)
}
