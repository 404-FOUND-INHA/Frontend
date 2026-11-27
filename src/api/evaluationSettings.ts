import { getPreviewScores } from '@/mocks/evaluation/previewScores'
import { getEvaluationSettingsStore } from '@/mocks/evaluation/settingsStore'
import type { DisposalPreviewResponse } from '@/types/evaluation/preview'
import type { EvaluationSettingsResponse, EvaluationSettingsUpdateRequest } from '@/types/evaluation/settings'
import { simulateLatency } from './scanSessions'

// 평가 설정 데이터 접근 계층. scanSessions.ts와 같은 규칙을 따른다: 지금은 Mock 저장소만 사용하고, 반환 타입은 실제 API의
// data와 같으며, 실패하면 저장소의 ApiError를 그대로 전달한다.

/** GET /api/evaluation/settings */
export async function getEvaluationSettings(): Promise<EvaluationSettingsResponse> {
  await simulateLatency()
  return getEvaluationSettingsStore().getActive()
}

/** PUT /api/evaluation/settings (사서 전용). 저장하면 새 버전이 활성화된다. */
export async function updateEvaluationSettings(request: EvaluationSettingsUpdateRequest): Promise<EvaluationSettingsResponse> {
  await simulateLatency()
  return getEvaluationSettingsStore().update(request)
}

/** 예상 영향 계산용 평가축 점수. Backend에 아직 없는 Mock 전용 조회다(types/evaluation/preview.ts 참고). */
export async function getDisposalPreviewScores(): Promise<DisposalPreviewResponse> {
  await simulateLatency()
  return getPreviewScores()
}
