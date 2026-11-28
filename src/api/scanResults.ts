import { getScanStore } from '@/mocks/scan/store'
import type { PageResponse } from '@/types/scan/api'
import type {
  DisposalCandidateListParams,
  EvaluationListResponse,
  ShelfCandidatesResponse,
} from '@/types/scan/evaluation'
import type { MissingCandidateListParams, MissingCandidateResponse } from '@/types/scan/missingCandidate'
import { simulateLatency } from './scanSessions'

// 최종 점검 결과(소재불명 후보, 폐기 검토 후보) 데이터 접근 계층. scanSessions.ts와 같은 규칙을 따른다: 지금은 Mock
// 저장소만 사용하고, 반환 타입은 실제 API의 data와 같으며, 실패하면 저장소의 ApiError를 그대로 전달한다.

/** GET /api/scan-sessions/{sessionId}/missing-candidates */
export async function getMissingCandidates(
  sessionId: number,
  params: MissingCandidateListParams = {},
): Promise<PageResponse<MissingCandidateResponse>> {
  await simulateLatency()
  return getScanStore().getMissingCandidates(sessionId, params)
}

/** GET /api/scan-sessions/{sessionId}/disposal-candidates */
export async function getDisposalCandidates(
  sessionId: number,
  params: DisposalCandidateListParams = {},
): Promise<EvaluationListResponse> {
  await simulateLatency()
  return getScanStore().getDisposalCandidates(sessionId, params)
}

/** GET /api/scan-sessions/{sessionId}/disposal-candidates/by-shelf (화면에서 쓰지 않는 shelfId 파라미터는 두지 않았다) */
export async function getDisposalCandidatesByShelf(sessionId: number): Promise<ShelfCandidatesResponse> {
  await simulateLatency()
  return getScanStore().getDisposalCandidatesByShelf(sessionId)
}
