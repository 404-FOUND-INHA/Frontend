import { getScanStore } from '@/mocks/scan/store'
import type {
  PageResponse,
  ScanRoomResponse,
  ScanSessionCreateRequest,
  ScanSessionListParams,
  ScanSessionResponse,
} from '@/types/scan/api'
import type { FinalizeResponse } from '@/types/scan/review'

// 장서점검 A1 데이터 접근 계층. 지금은 Mock 저장소만 사용하고 실제 HTTP 구현은 연동 이슈에서 추가한다.
// 함수 시그니처와 반환 타입은 실제 API의 data(응답 봉투를 벗긴 값)와 같고,
// 실패하면 상태 코드와 Backend 에러 코드를 가진 ApiError를 던진다. UI와 훅은 이 파일만 바라본다.

const MOCK_LATENCY_MS = 300

// 화면에서 로딩 상태가 보이도록 지연시키되, 테스트에서는 지연하지 않는다.
// 지연 후에 저장소를 읽고 바꾸므로 검사와 저장 사이에 await가 끼지 않는다. (store.ts 설명 참고)
export function simulateLatency(): Promise<void> {
  if (import.meta.env.MODE === 'test') return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS))
}

/** GET /api/scan-sessions/rooms */
export async function getScanRooms(): Promise<ScanRoomResponse[]> {
  await simulateLatency()
  return getScanStore().getRooms()
}

/** GET /api/scan-sessions */
export async function getScanSessions(params: ScanSessionListParams = {}): Promise<PageResponse<ScanSessionResponse>> {
  await simulateLatency()
  return getScanStore().getSessions(params)
}

/** GET /api/scan-sessions/{id} */
export async function getScanSession(id: number): Promise<ScanSessionResponse> {
  await simulateLatency()
  return getScanStore().getSession(id)
}

/** POST /api/scan-sessions (사서 전용, 권한 처리는 실제 API 연동 단계에서 다룬다) */
export async function createScanSession(request: ScanSessionCreateRequest): Promise<ScanSessionResponse> {
  await simulateLatency()
  return getScanStore().createSession(request)
}

/** POST /api/scan-sessions/{id}/finalize (사서 전용, 권한 처리는 실제 API 연동 단계에서 다룬다) */
export async function finalizeScanSession(id: number): Promise<FinalizeResponse> {
  await simulateLatency()
  return getScanStore().finalizeSession(id)
}
