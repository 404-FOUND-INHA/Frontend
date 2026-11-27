import { isApiError, ERROR_CODE } from '@/api/ApiError'
import type { PreviewBookScores } from '@/types/evaluation/preview'
import {
  CRITERION_TYPES,
  type CriterionType,
  type EvaluationSettingsResponse,
  type EvaluationSettingsUpdateRequest,
} from '@/types/evaluation/settings'

// 설정 화면의 순수 로직. 화면은 정수 단위(기준 점수 1점, 가중치 1%)로 편집하고, 요청을 만들 때 API 단위(0~1)로 바꾼다.

export const CRITERION_LABEL: Record<CriterionType, { name: string; hint: string }> = {
  DEMAND: { name: '수요성', hint: '대출 이력' },
  RARITY: { name: '희소성', hint: '대체 불가성' },
  DUPLICATION: { name: '중복성', hint: '복본 현황' },
  CONTENT_VALIDITY: { name: '내용 유효성', hint: '시의성' },
  PHYSICAL_CONDITION: { name: '물리적 상태', hint: '훼손도' },
}

/** 편집 중인 기준. threshold는 점(0~100), weights는 %(0~100) 정수다. */
export interface SettingsDraft {
  threshold: number
  weights: Record<CriterionType, number>
}

/** Backend 기본값(EvaluationSettingsService.defaults): 기준 50점, 모든 평가축 20% */
export const DEFAULT_DRAFT: Readonly<SettingsDraft> = {
  threshold: 50,
  weights: { DEMAND: 20, RARITY: 20, DUPLICATION: 20, CONTENT_VALIDITY: 20, PHYSICAL_CONDITION: 20 },
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** 응답을 편집 단위로 바꾼다. 정수가 아닌 값은 반올림하므로, 이때 가중치 합계가 100%가 아닐 수 있다(합계 오류로 표시된다). */
export function toDraft(settings: EvaluationSettingsResponse): SettingsDraft {
  const weights = { ...DEFAULT_DRAFT.weights }
  for (const type of CRITERION_TYPES) {
    const item = settings.weights.find((w) => w.criterion === type)
    weights[type] = item ? clampPercent(item.weight * 100) : 0
  }
  return { threshold: clampPercent(settings.disposalThreshold), weights }
}

export function toRequest(draft: SettingsDraft): EvaluationSettingsUpdateRequest {
  return {
    disposalThreshold: draft.threshold,
    weights: CRITERION_TYPES.map((criterion) => ({ criterion, weight: draft.weights[criterion] / 100 })),
  }
}

export function weightSum(draft: SettingsDraft): number {
  return CRITERION_TYPES.reduce((sum, type) => sum + draft.weights[type], 0)
}

export function isSameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return a.threshold === b.threshold && CRITERION_TYPES.every((type) => a.weights[type] === b.weights[type])
}

/** 가중치 합계 표시. 100%가 아니면 얼마나 넘거나 모자란지 함께 보여 준다. */
export function weightSumLabel(sum: number): { ok: boolean; text: string } {
  if (sum === 100) return { ok: true, text: '100% 정상' }
  return sum > 100 ? { ok: false, text: `${sum}% (${sum - 100}% 초과)` } : { ok: false, text: `${sum}% (${100 - sum}% 부족)` }
}

/** 부호를 붙인 변화량. 0이면 부호 없이 0이다. */
export function signed(delta: number, unit: string): string {
  return `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${Math.abs(delta)}${unit}`
}

export interface DraftChanges {
  threshold: { from: number; to: number } | null
  /** 바뀐 평가축만, 평가축 순서대로 */
  weights: { criterion: CriterionType; delta: number }[]
}

export function diffDraft(saved: SettingsDraft, draft: SettingsDraft): DraftChanges {
  return {
    threshold: saved.threshold === draft.threshold ? null : { from: saved.threshold, to: draft.threshold },
    weights: CRITERION_TYPES.filter((type) => saved.weights[type] !== draft.weights[type]).map((criterion) => ({
      criterion,
      delta: draft.weights[criterion] - saved.weights[criterion],
    })),
  }
}

/**
 * 예상 폐기 검토 후보 수. Backend CompositeScoreCalculator와 같은 규칙이다:
 * 종합 점수 = Σ(점수 × 가중치)를 소수 둘째 자리에서 반올림(HALF_UP)하고, 기준 점수 이상이면 후보다.
 * 가중치가 0보다 큰 평가축의 점수가 없으면 평가 불가이며 후보에 넣지 않는다.
 * 부동소수 오차가 없도록 점수 × 가중치(%)를 정수로 계산한다. 점수는 정수라고 가정한다(Mock fixture).
 */
export function countDisposalCandidates(books: readonly PreviewBookScores[], draft: SettingsDraft): number {
  // 종합 점수 × 100 (소수 둘째 자리까지의 정수) 과 기준 점수 × 100을 비교한다.
  const thresholdHundredths = draft.threshold * 100
  let count = 0
  for (const { scores } of books) {
    let sum = 0 // 종합 점수 × 10000
    let evaluable = true
    for (const type of CRITERION_TYPES) {
      const weight = draft.weights[type]
      const score = scores[type]
      if (score === null) {
        if (weight > 0) evaluable = false
        continue
      }
      sum += Math.round(score * 100) * weight // (점수 × 100) × 가중치(%)
    }
    if (!evaluable) continue
    const finalHundredths = Math.floor((sum + 50) / 100) // HALF_UP (sum ≥ 0)
    if (finalHundredths >= thresholdHundredths) count++
  }
  return count
}

/** 예상 후보 수의 변화 표시 */
export function previewDeltaText(current: number, next: number): string {
  return current === next ? '(변동 없음)' : `(${signed(next - current, '권')})`
}

/** 저장 버튼. 저장할 수 없는 이유가 합계 오류이면 그 이유를 라벨에 보여 준다. */
export function saveButtonState({
  dirty,
  sumOk,
  pending,
}: {
  dirty: boolean
  sumOk: boolean
  pending: boolean
}): { disabled: boolean; label: string; locked: boolean } {
  if (!sumOk) return { disabled: true, label: '저장 (합계 100% 필요)', locked: true }
  return { disabled: !dirty || pending, label: pending ? '저장 중…' : '저장', locked: false }
}

export const SAVE_ERROR_TEXT = {
  offline: '네트워크 연결을 확인한 후 다시 시도해 주세요.',
  invalidWeights: '가중치 설정이 올바르지 않습니다. 합계가 100%인지 확인해 주세요.',
  forbidden: '기준을 변경할 권한이 없습니다. 사서 계정으로 로그인해 주세요.',
  invalidInput: '입력한 값이 올바르지 않습니다.',
  generic: '기준을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
} as const

export function saveErrorText(error: unknown, online: boolean = true): string {
  if (!online) return SAVE_ERROR_TEXT.offline
  if (!isApiError(error)) return SAVE_ERROR_TEXT.generic
  switch (error.code) {
    case ERROR_CODE.EVALUATION_INVALID_WEIGHTS:
      return SAVE_ERROR_TEXT.invalidWeights
    case ERROR_CODE.FORBIDDEN:
      return SAVE_ERROR_TEXT.forbidden
    case ERROR_CODE.INVALID_INPUT:
      return SAVE_ERROR_TEXT.invalidInput
    default:
      return SAVE_ERROR_TEXT.generic
  }
}

/** 'YYYY-MM-DDTHH:mm:ss' → 'YYYY.MM.DD' */
export function formatConfiguredDate(configuredAt: string | null): string | null {
  const match = configuredAt?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}
