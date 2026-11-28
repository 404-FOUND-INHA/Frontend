import { getScanStore } from '@/mocks/scan/store'
import type { ShelfListParams, ShelfResponse } from '@/types/scan/shelf'
import { simulateLatency } from './scanSessions'

// 서가 데이터 접근 계층. scanSessions.ts와 같은 규칙을 따른다: 지금은 Mock 저장소만 사용하고, 반환 타입은 실제 API의
// data와 같으며, 실패하면 저장소의 ApiError를 그대로 전달한다.

/** GET /api/shelves */
export async function getShelves(params: ShelfListParams = {}): Promise<ShelfResponse[]> {
  await simulateLatency()
  return getScanStore().getShelves(params)
}
