// Mock 저장소 내부 모델. 실제 API 계약이 아니라 DB 테이블(shelf, scan_session, scan_session_shelf)을 단순화한 것이다.
import type { ScanSessionStatus } from '@/types/scan/api'

export interface MockShelf {
  id: number
  shelfCode: string
  zone: string | null
  floorNo: number | null
  active: boolean
}

/** 응답 DTO에서 저장하지 않고 계산하는 값(processingStage, floorNo)을 뺀 회차 */
export interface MockSession {
  id: number
  sessionName: string
  status: ScanSessionStatus
  zone: string | null
  plannedStartDate: string | null
  startedAt: string | null
  finalizedAt: string | null
  createdAt: string
}

export type MockScanShelfStatus = 'WAITING' | 'RESULT_RECEIVED'

/** 회차의 점검 대상 서가. 회차 생성 시점의 활성 서가가 등록된다. */
export interface MockSessionShelf {
  sessionId: number
  shelfId: number
  scanStatus: MockScanShelfStatus
}

export interface MockData {
  shelves: MockShelf[]
  sessions: MockSession[]
  sessionShelves: MockSessionShelf[]
}
