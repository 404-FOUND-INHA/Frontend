import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { FieldError } from '@/types/scan/api'
import {
  CRITERION_TYPES,
  type CriterionType,
  type CriterionWeight,
  type EvaluationSettingsResponse,
  type EvaluationSettingsUpdateRequest,
} from '@/types/evaluation/settings'
import { seoulDateTime } from '@/utils/seoulTime'
import { SEED_LIBRARIAN } from '@/mocks/scan/seedReview'

// 평가 설정의 메모리 저장소. Backend EvaluationSettingsService의 규칙을 따른다.
// - 저장하면 새 버전(v1, v2 …)이 활성화되고, 저장된 적이 없으면 기본값(기준 50점, 모든 평가축 동일 가중치)을 돌려준다.
// - 가중치는 모든 평가축이 정확히 한 번씩, 0~1(소수 넷째 자리), 합계가 정확히 1.0이어야 한다.
// - 기준 점수는 0~100(소수 둘째 자리)이다.
// 메서드는 모두 동기 함수다(scan store.ts와 같은 이유). 새로고침하면 시드로 초기화된다.

const DEFAULT_DISPOSAL_THRESHOLD = 50
const WEIGHT_SCALE = 10_000 // 소수 넷째 자리
const THRESHOLD_SCALE = 100 // 소수 둘째 자리

const MESSAGE = {
  INVALID_INPUT: '잘못된 입력입니다.',
} as const

export interface StoredProfile {
  profileVersion: string
  disposalThreshold: number
  /** 평가축 순서(CRITERION_TYPES)대로 */
  weights: CriterionWeight[]
  configuredBy: number
  configuredAt: string
}

export interface EvaluationSettingsStore {
  getActive(): EvaluationSettingsResponse
  /** 검증을 통과하면 새 버전으로 저장하고 활성화한다. 실패하면 아무것도 바뀌지 않는다. */
  update(request: EvaluationSettingsUpdateRequest): EvaluationSettingsResponse
}

export interface EvaluationSettingsStoreOptions {
  now?: () => number
}

/** 시드: 이미 한 번 저장된 설정(v1)이 활성 상태다. */
export const SEED_PROFILE: Readonly<StoredProfile> = {
  profileVersion: 'v1',
  disposalThreshold: 60,
  weights: [
    { criterion: 'DEMAND', weight: 0.3 },
    { criterion: 'RARITY', weight: 0.2 },
    { criterion: 'DUPLICATION', weight: 0.2 },
    { criterion: 'CONTENT_VALIDITY', weight: 0.15 },
    { criterion: 'PHYSICAL_CONDITION', weight: 0.15 },
  ],
  configuredBy: SEED_LIBRARIAN.id,
  configuredAt: '2026-11-09T10:00:00',
}

function invalidInput(errors: FieldError[]): ApiError {
  return new ApiError(400, { code: ERROR_CODE.INVALID_INPUT, message: MESSAGE.INVALID_INPUT, errors })
}

function invalidWeights(message: string): ApiError {
  return new ApiError(400, { code: ERROR_CODE.EVALUATION_INVALID_WEIGHTS, message, errors: [] })
}

/** 값이 범위 안이고 소수 자릿수를 넘지 않는가(Bean Validation @DecimalMin/@DecimalMax/@Digits) */
function isDecimalWithin(value: unknown, min: number, max: number, scale: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return false
  const scaled = value * scale
  return Math.abs(scaled - Math.round(scaled)) < 1e-6
}

/** Bean Validation 단계(400 COMMON_001). 필드 오류를 모두 모은다. */
function validateFields(request: EvaluationSettingsUpdateRequest): FieldError[] {
  const errors: FieldError[] = []
  if (!isDecimalWithin(request?.disposalThreshold, 0, 100, THRESHOLD_SCALE)) {
    errors.push({ field: 'disposalThreshold', reason: 'must be between 0.0 and 100.0 with up to 2 fraction digits' })
  }
  const weights: unknown = request?.weights
  if (!Array.isArray(weights) || weights.length === 0) {
    errors.push({ field: 'weights', reason: 'must not be empty' })
    return errors
  }
  weights.forEach((item: Partial<CriterionWeight> | null, i) => {
    if (item === null || typeof item !== 'object') {
      errors.push({ field: `weights[${i}]`, reason: 'must not be null' })
      return
    }
    if (!CRITERION_TYPES.includes(item.criterion as CriterionType)) {
      errors.push({ field: `weights[${i}].criterion`, reason: 'must not be null' })
    }
    if (!isDecimalWithin(item.weight, 0, 1, WEIGHT_SCALE)) {
      errors.push({ field: `weights[${i}].weight`, reason: 'must be between 0.0 and 1.0 with up to 4 fraction digits' })
    }
  })
  return errors
}

/** 서비스 검증 단계(400 EVAL_001). 평가축 순서대로 정리한 가중치를 돌려준다. 합계는 정수(만분율)로 비교한다. */
function validateWeights(items: CriterionWeight[]): CriterionWeight[] {
  const byType = new Map<CriterionType, number>()
  for (const item of items) {
    if (byType.has(item.criterion)) throw invalidWeights(`평가축이 중복되었습니다: ${item.criterion}`)
    byType.set(item.criterion, Math.round(item.weight * WEIGHT_SCALE))
  }
  for (const type of CRITERION_TYPES) {
    if (!byType.has(type)) throw invalidWeights(`모든 평가축의 가중치가 필요합니다. 누락: ${type}`)
  }
  const sum = [...byType.values()].reduce((a, b) => a + b, 0)
  if (sum !== WEIGHT_SCALE) {
    throw invalidWeights(`가중치의 합은 1.0 이어야 합니다. (현재 ${sum / WEIGHT_SCALE})`)
  }
  return CRITERION_TYPES.map((criterion) => ({ criterion, weight: byType.get(criterion)! / WEIGHT_SCALE }))
}

function toResponse(profile: StoredProfile): EvaluationSettingsResponse {
  return {
    profileVersion: profile.profileVersion,
    isDefault: false,
    disposalThreshold: profile.disposalThreshold,
    weights: profile.weights.map((w) => ({ ...w })),
    configuredBy: profile.configuredBy,
    configuredAt: profile.configuredAt,
  }
}

function defaults(): EvaluationSettingsResponse {
  const equal = Math.round(WEIGHT_SCALE / CRITERION_TYPES.length) / WEIGHT_SCALE
  return {
    profileVersion: null,
    isDefault: true,
    disposalThreshold: DEFAULT_DISPOSAL_THRESHOLD,
    weights: CRITERION_TYPES.map((criterion) => ({ criterion, weight: equal })),
    configuredBy: null,
    configuredAt: null,
  }
}

/** 저장된 적이 없을 때 Backend가 돌려주는 기본값 */
export const DEFAULT_SETTINGS: Readonly<EvaluationSettingsResponse> = defaults()

export function createEvaluationSettingsStore(
  profiles: readonly StoredProfile[],
  { now = Date.now }: EvaluationSettingsStoreOptions = {},
): EvaluationSettingsStore {
  // 마지막 항목이 활성 버전이다.
  const history: StoredProfile[] = profiles.map((p) => ({ ...p, weights: p.weights.map((w) => ({ ...w })) }))

  return {
    getActive() {
      const active = history.at(-1)
      return active ? toResponse(active) : defaults()
    },

    update(request) {
      const errors = validateFields(request)
      if (errors.length > 0) throw invalidInput(errors)
      const weights = validateWeights(request.weights)

      let n = history.length + 1
      while (history.some((p) => p.profileVersion === `v${n}`)) n++
      const profile: StoredProfile = {
        profileVersion: `v${n}`,
        disposalThreshold: Math.round(request.disposalThreshold * THRESHOLD_SCALE) / THRESHOLD_SCALE,
        weights,
        configuredBy: SEED_LIBRARIAN.id,
        configuredAt: seoulDateTime(now()),
      }
      history.push(profile)
      return toResponse(profile)
    },
  }
}

let current: EvaluationSettingsStore | null = null

export function getEvaluationSettingsStore(): EvaluationSettingsStore {
  current ??= createEvaluationSettingsStore([SEED_PROFILE])
  return current
}

/** 테스트용: 시드(또는 지정한 저장 이력)로 되돌린다. 빈 배열이면 저장된 적이 없는 상태다. */
export function resetEvaluationSettingsStore(
  options: EvaluationSettingsStoreOptions & { profiles?: readonly StoredProfile[] } = {},
): void {
  current = createEvaluationSettingsStore(options.profiles ?? [SEED_PROFILE], options)
}
