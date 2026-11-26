// Mock 저장소 내부 모델. 실제 API 계약이 아니라 DB 테이블(shelf, scan_session, scan_session_shelf,
// book, book_observation, observation_match_candidate, review, app_user)을 단순화한 것이다.
import type {
  BookLifecycleStatus,
  CandidateReason,
  ObservationAnalysisStatus,
  ObservationStatusReason,
  ScanShelfStatus,
} from '@/types/scan/analysis'
import type { ScanSessionStatus } from '@/types/scan/api'
import type { ReviewAction, ReviewFinalStatus } from '@/types/scan/review'

export interface MockShelf {
  id: number
  shelfCode: string
  zone: string | null
  floorNo: number | null
  widthCm: number | null
  /** 서가 목록의 표시 순서. 조회 응답에는 담지 않고 정렬에만 쓴다. */
  displayOrder: number | null
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

export type MockScanShelfStatus = ScanShelfStatus

/**
 * 회차의 점검 대상 서가. 회차 생성 시점의 활성 서가가 등록된다.
 * 관측 수(detectedBookCount)와 촬영 시각(scannedAt)은 저장하지 않고 관측에서 계산한다.
 */
export interface MockSessionShelf {
  sessionId: number
  shelfId: number
  scanStatus: MockScanShelfStatus
}

/** 도서 원장 */
export interface MockBook {
  id: number
  registrationNo: string
  title: string
  callNumber: string
  copyNumber: string | null
  lifecycleStatus: BookLifecycleStatus
  expectedShelfId: number | null
  widthCm: number | null
}

export interface MockCandidate {
  rank: number
  reason: CandidateReason | null
  bookId: number
}

/**
 * 관측 1건과 자동 분석 결과. 판정은 시드(또는 테스트 데이터)가 정해 두며 Mock은 매칭을 수행하지 않는다.
 * Backend는 detectedShelfId에 NULL을 허용하지만 결과 수신 시 항상 채우므로 Mock에서는 필수다.
 */
export interface MockObservation {
  id: number
  sessionId: number
  shelfId: number
  detectedOrder: number
  xPositionCm: number | null
  detectedLabelRaw: string | null
  detectedTitle: string | null
  detectedClassificationNo: string | null
  detectedBookSymbol: string | null
  detectedCopyNumber: string | null
  detectedAt: string | null
  receivedAt: string
  analysisStatus: ObservationAnalysisStatus
  statusReason: ObservationStatusReason | null
  matchConfidence: number | null
  bookId: number | null
  candidates: MockCandidate[]
}

/** 검토자 (app_user 중 응답에 필요한 값) */
export interface MockUser {
  id: number
  name: string
}

/**
 * 관측 1건에 대한 사서의 검토 결과(관측당 최대 1건). 자동 분석 결과(MockObservation)는 바꾸지 않고 따로 보관한다.
 * 검토 건수와 완료 여부는 저장하지 않고 이 기록에서 계산한다.
 */
export interface MockReview {
  id: number
  observationId: number
  action: ReviewAction
  finalStatus: ReviewFinalStatus
  finalBookId: number | null
  reviewerId: number
  comment: string | null
  reviewedAt: string
}

export interface MockData {
  shelves: MockShelf[]
  sessions: MockSession[]
  sessionShelves: MockSessionShelf[]
  books: MockBook[]
  observations: MockObservation[]
  users: MockUser[]
  reviews: MockReview[]
}
