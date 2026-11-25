import { ERROR_CODE, isApiError } from '@/api/ApiError'
import type { ScanSessionResponse, ScanSessionStatus } from '@/types/scan/api'
import { toDisplayDate } from './scanListView'

// 회차 상세 화면의 표시 규칙(순수 함수). 화면 컴포넌트에서 분리해 단위 테스트한다.
// 처리 단계는 status만으로 결정된다(Backend가 processingStage를 status에서 계산하며 ANALYZING은 반환하지 않는다).

/**
 * URL의 sessionId. 양의 정수 문자열일 때만 숫자로 바꾸고, 그 외(abc, 0, -1, 1.5, 01, 빈 값, 안전하지 않은 큰 수)는 null이다.
 * null이면 조회 요청을 보내지 않는다.
 */
export function parseSessionId(param: string | undefined): number | null {
  if (!param || !/^[1-9]\d*$/.test(param)) return null
  const id = Number(param)
  return Number.isSafeInteger(id) ? id : null
}

/** 상세 화면의 상태 배지 문구. 목록(진행 중/검토 중/완료)과 IN_PROGRESS 문구가 다르다. */
export const DETAIL_STATUS_LABEL: Record<ScanSessionStatus, string> = {
  IN_PROGRESS: '결과 대기',
  REVIEW: '검토 중',
  COMPLETED: '완료',
}

export type StepState = 'current' | 'done' | 'waiting'

export interface ProgressStep {
  title: string
  description: string
  state: StepState
}

export interface ProgressView {
  sectionTitle: string
  steps: [ProgressStep, ProgressStep]
  notice: { icon: 'clock' | 'check'; title: string; text: string }
}

const VISION_TITLE = 'Vision 결과 수신 및 자동 분석'
const REVIEW_TITLE = '사서 검토'

export function getProgressView(status: ScanSessionStatus): ProgressView {
  switch (status) {
    case 'IN_PROGRESS':
      return {
        sectionTitle: '장서점검 처리 단계',
        steps: [
          { title: VISION_TITLE, description: 'Vision 분석 결과가 전달되기를 기다리고 있습니다.', state: 'current' },
          { title: REVIEW_TITLE, description: '이상 도서 검토 및 회차 확정 대기', state: 'waiting' },
        ],
        notice: {
          icon: 'clock',
          title: '점검 결과를 기다리고 있어요',
          text: 'Vision 결과가 도착하면 자동으로 분석이 시작됩니다.',
        },
      }
    case 'REVIEW':
      return {
        sectionTitle: '장서점검 진행 현황',
        steps: [
          { title: VISION_TITLE, description: '도서 매칭 및 배치 상태 판정 완료', state: 'done' },
          { title: REVIEW_TITLE, description: '이상 도서 검토 및 회차 확정 대기', state: 'current' },
        ],
        notice: {
          icon: 'check',
          title: '자동 분석이 완료되었습니다',
          text: '사서의 이상 도서 검토를 기다리고 있습니다.',
        },
      }
    case 'COMPLETED':
      return {
        sectionTitle: '장서점검 진행 현황',
        steps: [
          { title: VISION_TITLE, description: '도서 매칭 및 배치 상태 판정 완료', state: 'done' },
          { title: REVIEW_TITLE, description: '이상 도서 검토 및 회차 확정 완료', state: 'done' },
        ],
        notice: {
          icon: 'check',
          title: '장서점검이 완료되었습니다',
          text: '모든 검토와 회차 확정이 완료되었습니다.',
        },
      }
  }
}

export interface DateRow {
  key: 'created' | 'planned' | 'finalized'
  label: string
  /** 'YYYY.MM.DD' */
  text: string
}

/**
 * 날짜 행. 필드마다 의미가 달라 따로 보여준다. 값이 없거나 유효하지 않으면 행을 만들지 않는다.
 * - 생성일: createdAt / 점검 예정일: plannedStartDate(입력한 경우만) / 확정일: finalizedAt(완료 상태일 때만)
 * startedAt은 표시하지 않는다. 예정일이 미래여도 상태와 시작 일시는 바뀌지 않는다.
 */
export function getDateRows(
  session: Pick<ScanSessionResponse, 'status' | 'createdAt' | 'plannedStartDate' | 'finalizedAt'>,
): DateRow[] {
  const rows: DateRow[] = []
  const created = toDisplayDate(session.createdAt)
  if (created) rows.push({ key: 'created', label: '생성일', text: created })
  const planned = toDisplayDate(session.plannedStartDate)
  if (planned) rows.push({ key: 'planned', label: '점검 예정일', text: planned })
  if (session.status === 'COMPLETED') {
    const finalized = toDisplayDate(session.finalizedAt)
    if (finalized) rows.push({ key: 'finalized', label: '확정일', text: finalized })
  }
  return rows
}

/** useScanSession 결과 중 판정에 필요한 값만 */
export interface DetailQuerySnapshot {
  /** URL의 sessionId가 유효한가(parseSessionId가 숫자를 돌려줬는가) */
  idValid: boolean
  isPending: boolean
  isError: boolean
  isFetching: boolean
  /** 캐시된 회차가 있는가 */
  hasData: boolean
  error: unknown
}

export interface DetailViewState {
  body: 'invalid' | 'loading' | 'notFound' | 'badRequest' | 'error' | 'content'
  /** 기존 내용을 유지한 채 재조회에 실패 */
  refreshError: boolean
  /** 조회 중: 다시 시도 버튼 중복 클릭 방지 */
  busy: boolean
}

export function getDetailViewState(s: DetailQuerySnapshot): DetailViewState {
  const busy = s.isFetching
  if (!s.idValid) return { body: 'invalid', refreshError: false, busy }
  const apiError = s.isError && isApiError(s.error) ? s.error : null
  // 명시적인 404 SCAN_001은 캐시가 있어도 존재하지 않는 회차다.
  if (apiError?.status === 404 && apiError.code === ERROR_CODE.SCAN_SESSION_NOT_FOUND) {
    return { body: 'notFound', refreshError: false, busy }
  }
  if (s.hasData) return { body: 'content', refreshError: s.isError, busy }
  if (s.isPending) return { body: 'loading', refreshError: false, busy }
  // 400 COMMON_001을 존재하지 않는 회차로 단정하지 않고 잘못된 요청으로 따로 안내한다.
  if (apiError?.status === 400 && apiError.code === ERROR_CODE.INVALID_INPUT) {
    return { body: 'badRequest', refreshError: false, busy }
  }
  return { body: 'error', refreshError: false, busy }
}
