import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { ObservationDetailResponse, ScanAnalysisResponse, ShelfObservationsResponse } from '@/types/scan/analysis'
import type {
  FieldError,
  PageResponse,
  ProcessingStage,
  ScanRoomResponse,
  ScanSessionCreateRequest,
  ScanSessionListParams,
  ScanSessionResponse,
  ScanSessionStatus,
} from '@/types/scan/api'
import type { DisposalCandidateListParams, EvaluationListResponse } from '@/types/scan/evaluation'
import type {
  MissingCandidateListParams,
  MissingCandidateResponse,
  MissingCandidateStatus,
} from '@/types/scan/missingCandidate'
import type { FinalizeResponse, ReviewListParams, ReviewListResponse } from '@/types/scan/review'
import { isValidIsoDate } from '@/utils/calendarDate'
import { seoulDate, seoulDateTime, seoulDateTimeWithMillis } from '@/utils/seoulTime'
import { buildAnalysis, buildObservationDetail, buildShelfObservations } from './analysis'
import { buildDisposalCandidates } from './evaluations'
import { applyFinalization, planFinalization } from './finalize'
import { buildMissingCandidatePage } from './missingCandidates'
import { buildReviewList, reviewSummaryOf } from './review'
import { createSeedData } from './seed'
import { SEED_LIBRARIAN } from './seedReview'
import type { MockData, MockSession } from './types'

// 메모리 단일 원본. 목록·상세·자료실·분석 결과·사서 검토 응답은 모두 이 데이터에서 읽을 때 파생한다. 새로고침하면 시드로 초기화된다.
// Backend ScanSessionService, ObservationQueryService, ReviewService(조회), ScanFinalizationService,
// MissingCandidateService(조회), EvaluationQueryService(폐기 검토 후보)의 규칙을 따르되,
// 실제 DB·락·권한·감사 로그·검증 메시지까지 재현하지는 않는다.
//
// 모든 메서드는 동기 함수다. "중복 검사 → 저장"이 await 없이 한 번에 실행되므로,
// 데이터 접근 계층(api/scanSessions.ts)에서 요청이 동시에 들어와도 이벤트 루프 안에서 끼어들 수 없다.
// (Backend의 Advisory Lock에 해당하는 역할. 락 자체를 구현하지는 않는다.)

export const OPEN_STATUSES: readonly ScanSessionStatus[] = ['IN_PROGRESS', 'REVIEW']
const ALL_STATUSES: readonly ScanSessionStatus[] = ['IN_PROGRESS', 'REVIEW', 'COMPLETED']
const MISSING_CANDIDATE_STATUSES: readonly MissingCandidateStatus[] = [
  'PENDING',
  'FOUND',
  'NOT_FOUND',
  'LOST_CANDIDATE',
  'RESOLVED',
]

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_OFFSET = 2_147_483_647 // Java int 최댓값. 넘으면 Backend는 400으로 막는다.
const MIN_INT = -2_147_483_648 // Java int 최솟값
const MAX_SESSION_NAME_LENGTH = 100
const MAX_ZONE_LENGTH = 30

// ErrorCode 기본 메시지 (Backend ErrorCode)
const MESSAGE = {
  INVALID_INPUT: '잘못된 입력입니다.',
  SCAN_SESSION_NOT_FOUND: '장서점검 회차를 찾을 수 없습니다.',
  SCAN_SESSION_ALREADY_OPEN: '해당 자료실에 완료되지 않은 점검 회차가 있습니다.',
  SCAN_NO_ACTIVE_SHELF: '점검할 수 있는 서가가 없는 자료실입니다.',
  SCAN_SHELF_NOT_IN_SESSION: '해당 회차의 점검 대상 서가가 아닙니다.',
  SCAN_OBSERVATION_NOT_FOUND: '해당 회차의 관측 도서를 찾을 수 없습니다.',
  SCAN_SESSION_NOT_FINALIZABLE: '확정할 수 있는 회차 상태가 아닙니다.',
} as const

export interface ScanStore {
  getRooms(): ScanRoomResponse[]
  getSessions(params?: ScanSessionListParams): PageResponse<ScanSessionResponse>
  getSession(id: number): ScanSessionResponse
  createSession(request: ScanSessionCreateRequest): ScanSessionResponse
  /** 자동 분석 결과 요약과 서가별 현황. 회차 상태와 무관하게 조회할 수 있고 수신 전에는 빈 결과다. */
  getAnalysis(sessionId: number): ScanAnalysisResponse
  getShelfObservations(sessionId: number, shelfId: number): ShelfObservationsResponse
  getObservation(sessionId: number, observationId: number): ObservationDetailResponse
  /** 검토 대상 목록과 회차 전체의 검토 진행 현황. 회차 상태와 무관하게 조회할 수 있다. */
  getReviews(sessionId: number, params?: ReviewListParams): ReviewListResponse
  /** 회차의 소재불명 후보 한 페이지. 회차 상태와 무관하게 조회할 수 있고 확정 전에는 빈 목록이다. */
  getMissingCandidates(sessionId: number, params?: MissingCandidateListParams): PageResponse<MissingCandidateResponse>
  /** 회차의 평가 현황과 폐기 검토 후보 한 페이지. 회차 상태와 무관하며 평가 결과가 없으면 모두 0이다. */
  getDisposalCandidates(sessionId: number, params?: DisposalCandidateListParams): EvaluationListResponse
  /** 검토를 마친 REVIEW 회차를 확정한다. 실패하면 아무것도 바뀌지 않는다. */
  finalizeSession(sessionId: number): FinalizeResponse
  /** 현재 저장소 내용의 복사본 (테스트·디버깅용) */
  snapshot(): MockData
}

export interface ScanStoreOptions {
  /** 현재 시각(epoch ms). 테스트에서 고정 시계를 주입한다. */
  now?: () => number
}

function fail(status: number, code: string, message: string, errors: FieldError[] = []): ApiError {
  return new ApiError(status, { code, message, errors })
}

function invalidInput(errors: FieldError[] = [], message: string = MESSAGE.INVALID_INPUT): ApiError {
  return fail(400, ERROR_CODE.INVALID_INPUT, message, errors)
}

/** Backend의 int 파라미터에 바인딩할 수 있는 값인가 */
function isJavaInt(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_INT && value <= MAX_OFFSET
}

/** 검토·후보·평가 조회의 page, size. 생략하면 기본값이고, int가 아니면 400이다. */
function requirePageParams(params: { page?: number; size?: number }): { page: number; size: number } {
  const requested = { page: params.page ?? 0, size: params.size ?? DEFAULT_PAGE_SIZE }
  if (!isJavaInt(requested.page) || !isJavaInt(requested.size)) throw invalidInput()
  return requested
}

/** 범위를 벗어난 page, size는 보정하고, 건너뛸 건수가 int를 넘으면 400이다. Backend처럼 회차 확인 뒤에 부른다. */
function clampPage(requested: { page: number; size: number }): { page: number; size: number } {
  const page = Math.max(requested.page, 0)
  const size = Math.min(Math.max(requested.size, 1), MAX_PAGE_SIZE)
  if (page * size > MAX_OFFSET) throw invalidInput([], 'page 값이 너무 큽니다.')
  return { page, size }
}

function processingStageOf(status: ScanSessionStatus): ProcessingStage {
  return status === 'IN_PROGRESS' ? 'VISION_WAITING' : 'ANALYSIS_DONE'
}

function validateRequiredText(field: string, value: unknown, maxLength: number): FieldError | null {
  // Bean Validation @NotBlank @Size. reason 문구는 Spring 기본 문구를 흉내 낸 것이며 계약이 아니다.
  if (typeof value !== 'string' || value.trim() === '') return { field, reason: 'must not be blank' }
  if (value.length > maxLength) return { field, reason: `size must be between 0 and ${maxLength}` }
  return null
}

export function createScanStore(initial: MockData, options: ScanStoreOptions = {}): ScanStore {
  const now = options.now ?? Date.now
  const data = structuredClone(initial)
  let nextSessionId = data.sessions.reduce((max, s) => Math.max(max, s.id), 0) + 1

  const openZones = () =>
    new Set(
      data.sessions
        .filter((s) => OPEN_STATUSES.includes(s.status) && s.zone !== null)
        .map((s) => s.zone as string),
    )

  const activeShelvesOf = (zone: string) =>
    data.shelves.filter((shelf) => shelf.active && shelf.zone === zone).sort((a, b) => a.id - b.id)

  /** 회차에 등록된 서가 층의 최솟값. 층 정보가 없으면 null (Backend findMinFloorsBySessionIds) */
  function floorsBySession(sessionIds: number[]): Map<number, number | null> {
    const wanted = new Set(sessionIds)
    const shelvesById = new Map(data.shelves.map((shelf) => [shelf.id, shelf]))
    const floors = new Map<number, number | null>()
    for (const link of data.sessionShelves) {
      if (!wanted.has(link.sessionId)) continue
      const floor = shelvesById.get(link.shelfId)?.floorNo ?? null
      const current = floors.get(link.sessionId) ?? null
      floors.set(link.sessionId, floor === null ? current : current === null ? floor : Math.min(current, floor))
    }
    return floors
  }

  function toResponse(session: MockSession, floorNo: number | null): ScanSessionResponse {
    return {
      id: session.id,
      sessionName: session.sessionName,
      status: session.status,
      processingStage: processingStageOf(session.status),
      zone: session.zone,
      floorNo,
      plannedStartDate: session.plannedStartDate,
      startedAt: session.startedAt,
      finalizedAt: session.finalizedAt,
      createdAt: session.createdAt,
    }
  }

  function requireSession(sessionId: number): MockSession {
    const session = data.sessions.find((s) => s.id === sessionId)
    if (!session) {
      throw fail(404, ERROR_CODE.SCAN_SESSION_NOT_FOUND, MESSAGE.SCAN_SESSION_NOT_FOUND)
    }
    return session
  }

  /**
   * 분석 결과와 검토 조회용. 모든 ID 파라미터를 먼저 검사해 안전한 정수가 아니면 400이고, 그다음 회차 존재를 확인한다.
   * 서가·관측 확인은 그 뒤다. Backend의 ID는 Java Long이라 2^53 - 1을 넘어도 Long 범위 안이면 404지만,
   * JavaScript number로는 그런 ID를 정확히 구분할 수 없어 Mock은 400으로 거부한다.
   * 0과 음수는 Backend처럼 존재하지 않는 ID(404)다.
   */
  function requireQueryTarget(sessionId: number, ...otherIds: number[]): MockSession {
    if (![sessionId, ...otherIds].every(Number.isSafeInteger)) throw invalidInput()
    return requireSession(sessionId)
  }

  return {
    getRooms() {
      const open = openZones()
      const byZone = new Map<string, { floorNo: number | null; shelfCount: number }>()
      for (const shelf of data.shelves) {
        // 활성 서가가 있고 zone이 비어 있지 않은 자료실만 (Backend summarizeActiveZones)
        if (!shelf.active || shelf.zone === null || shelf.zone.trim() === '') continue
        const entry = byZone.get(shelf.zone) ?? { floorNo: null, shelfCount: 0 }
        entry.shelfCount += 1
        if (shelf.floorNo !== null) {
          entry.floorNo = entry.floorNo === null ? shelf.floorNo : Math.min(entry.floorNo, shelf.floorNo)
        }
        byZone.set(shelf.zone, entry)
      }
      return [...byZone.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // DB collation과 완전히 같지는 않다 (한계)
        .map(([zone, { floorNo, shelfCount }]) => ({ zone, floorNo, shelfCount, hasOpenSession: open.has(zone) }))
    },

    getSessions(params = {}) {
      const statuses = params.status ?? []
      if (statuses.some((status) => !ALL_STATUSES.includes(status))) throw invalidInput()
      if (
        (params.page !== undefined && !Number.isInteger(params.page)) ||
        (params.size !== undefined && !Number.isInteger(params.size))
      ) {
        throw invalidInput()
      }
      const page = Math.max(params.page ?? 0, 0)
      const size = Math.min(Math.max(params.size ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
      if (page * size > MAX_OFFSET) throw invalidInput() // Backend는 "page 값이 너무 큽니다." 메시지를 쓴다

      const filtered = data.sessions
        .filter((s) => statuses.length === 0 || statuses.includes(s.status))
        .sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1))
      const pageItems = filtered.slice(page * size, page * size + size)
      const floors = floorsBySession(pageItems.map((s) => s.id))
      return {
        content: pageItems.map((s) => toResponse(s, floors.get(s.id) ?? null)),
        page,
        size,
        totalElements: filtered.length,
        totalPages: Math.ceil(filtered.length / size),
      }
    },

    getSession(id) {
      if (!Number.isInteger(id)) throw invalidInput()
      const session = requireSession(id)
      return toResponse(session, floorsBySession([id]).get(id) ?? null)
    },

    getAnalysis(sessionId) {
      const { id, status } = requireQueryTarget(sessionId)
      return buildAnalysis(data, { id, status, processingStage: processingStageOf(status) })
    },

    getShelfObservations(sessionId, shelfId) {
      requireQueryTarget(sessionId, shelfId)
      const link = data.sessionShelves.find((ss) => ss.sessionId === sessionId && ss.shelfId === shelfId)
      if (!link) {
        throw fail(404, ERROR_CODE.SCAN_SHELF_NOT_IN_SESSION, MESSAGE.SCAN_SHELF_NOT_IN_SESSION)
      }
      return buildShelfObservations(data, link)
    },

    getObservation(sessionId, observationId) {
      requireQueryTarget(sessionId, observationId)
      const observation = data.observations.find((o) => o.id === observationId && o.sessionId === sessionId)
      if (!observation) {
        throw fail(404, ERROR_CODE.SCAN_OBSERVATION_NOT_FOUND, MESSAGE.SCAN_OBSERVATION_NOT_FOUND)
      }
      return buildObservationDetail(data, observation)
    },

    getReviews(sessionId, params = {}) {
      const { shelfId, reviewed } = params
      // 파라미터 형식 오류(400)는 회차 확인보다 먼저다.
      const requested = requirePageParams(params)
      if (reviewed !== undefined && typeof reviewed !== 'boolean') throw invalidInput()
      // shelfId는 회차의 대상 서가인지 확인하지 않는다. 대상이 아니면 빈 목록이다.
      requireQueryTarget(sessionId, ...(shelfId === undefined ? [] : [shelfId]))
      return buildReviewList(data, sessionId, { shelfId, reviewed, ...clampPage(requested) })
    },

    getMissingCandidates(sessionId, params = {}) {
      const { status } = params
      const requested = requirePageParams(params)
      if (status !== undefined && !MISSING_CANDIDATE_STATUSES.includes(status)) throw invalidInput()
      requireQueryTarget(sessionId)
      return buildMissingCandidatePage(data, sessionId, { status, ...clampPage(requested) })
    },

    getDisposalCandidates(sessionId, params = {}) {
      const requested = requirePageParams(params)
      requireQueryTarget(sessionId)
      return buildDisposalCandidates(data, sessionId, clampPage(requested))
    },

    createSession(request) {
      // 1) 요청 본문 파싱: 잘못된 날짜 형식은 검증 오류보다 먼저 400(errors 없음)이 된다.
      const planned = request.plannedStartDate
      if (planned !== undefined && planned !== null && (typeof planned !== 'string' || !isValidIsoDate(planned))) {
        throw invalidInput()
      }
      // 2) Bean Validation
      const fieldErrors = [
        validateRequiredText('sessionName', request.sessionName, MAX_SESSION_NAME_LENGTH),
        validateRequiredText('zone', request.zone, MAX_ZONE_LENGTH),
      ].filter((error): error is FieldError => error !== null)
      if (fieldErrors.length > 0) throw invalidInput(fieldErrors)

      // 3) 서비스 규칙: 예정일 → 미완료 회차 → 활성 서가
      const currentMs = now()
      if (planned && planned < seoulDate(currentMs)) {
        throw fail(400, ERROR_CODE.INVALID_INPUT, '점검 예정일은 오늘 이후여야 합니다.')
      }
      if (openZones().has(request.zone)) {
        throw fail(409, ERROR_CODE.SCAN_SESSION_ALREADY_OPEN, MESSAGE.SCAN_SESSION_ALREADY_OPEN)
      }
      const shelves = activeShelvesOf(request.zone)
      if (shelves.length === 0) {
        throw fail(400, ERROR_CODE.SCAN_NO_ACTIVE_SHELF, MESSAGE.SCAN_NO_ACTIVE_SHELF)
      }

      // 4) 저장: 회차와 대상 서가를 함께 등록한다. (검증을 모두 통과한 뒤에만 데이터를 바꾼다)
      // Mock 정책: startedAt과 createdAt을 같은 시각으로 만든다. 실제 Backend는 두 값이 같다고 보장하지 않는다.
      const createdAt = seoulDateTime(currentMs)
      const session: MockSession = {
        id: nextSessionId++,
        sessionName: request.sessionName,
        status: 'IN_PROGRESS',
        zone: request.zone,
        plannedStartDate: planned ?? null,
        startedAt: createdAt,
        finalizedAt: null,
        finalizedBy: null,
        createdAt,
      }
      data.sessions.push(session)
      for (const shelf of shelves) {
        data.sessionShelves.push({ sessionId: session.id, shelfId: shelf.id, scanStatus: 'WAITING' })
      }
      return toResponse(session, floorsBySession([session.id]).get(session.id) ?? null)
    },

    finalizeSession(sessionId) {
      // 검사 순서: ID(400) → 회차(404) → 상태(SCAN_009) → 미처리 검토(SCAN_010)
      // 서가의 수신 여부는 따로 검사하지 않는다. REVIEW 회차는 모든 대상 서가가 수신 상태다.
      const session = requireQueryTarget(sessionId)
      if (session.status !== 'REVIEW') {
        throw fail(409, ERROR_CODE.SCAN_SESSION_NOT_FINALIZABLE, MESSAGE.SCAN_SESSION_NOT_FINALIZABLE)
      }
      const { remaining } = reviewSummaryOf(data, sessionId)
      if (remaining > 0) {
        throw fail(409, ERROR_CODE.SCAN_REVIEW_INCOMPLETE, `검토가 끝나지 않은 관측이 ${remaining}건 있어 확정할 수 없습니다.`)
      }
      // 같은 초에 기록된 시각과 전후를 가리려면 밀리초가 필요하다.
      const plan = planFinalization(data, session, { now: seoulDateTimeWithMillis(now()), userId: SEED_LIBRARIAN.id })
      applyFinalization(data, plan)
      return plan.response
    },

    snapshot() {
      return structuredClone(data)
    },
  }
}

// 앱 전체가 공유하는 Mock 저장소. 모듈이 처음 쓰일 때 시드로 만들어지고, 새로고침하면 초기화된다.
let current: ScanStore | null = null

export function getScanStore(): ScanStore {
  current ??= createScanStore(createSeedData())
  return current
}

/** 저장소를 시드(또는 지정한 데이터)로 되돌린다. 테스트에서 매번 깨끗한 상태로 시작할 때 사용한다. */
export function resetScanStore(options: ScanStoreOptions & { data?: MockData } = {}): void {
  current = createScanStore(options.data ?? createSeedData(), { now: options.now })
}
