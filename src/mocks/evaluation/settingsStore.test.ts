import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import type { EvaluationSettingsUpdateRequest } from '@/types/evaluation/settings'
import { DEFAULT_SETTINGS, SEED_PROFILE, createEvaluationSettingsStore } from './settingsStore'

const NOW = Date.parse('2026-11-27T03:00:00Z') // 서울 12:00

const VALID: EvaluationSettingsUpdateRequest = {
  disposalThreshold: 55,
  weights: [
    { criterion: 'DEMAND', weight: 0.35 },
    { criterion: 'RARITY', weight: 0.2 },
    { criterion: 'DUPLICATION', weight: 0.15 },
    { criterion: 'CONTENT_VALIDITY', weight: 0.15 },
    { criterion: 'PHYSICAL_CONDITION', weight: 0.15 },
  ],
}

function storeWithSeed() {
  return createEvaluationSettingsStore([SEED_PROFILE], { now: () => NOW })
}

function catchError(fn: () => unknown): ApiError {
  try {
    fn()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('오류가 발생하지 않았습니다')
}

describe('평가 설정 조회', () => {
  it('저장된 설정이 없으면 기준 50점, 모든 평가축 0.2의 기본값이다', () => {
    const store = createEvaluationSettingsStore([])
    expect(store.getActive()).toStrictEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS).toMatchObject({ profileVersion: null, isDefault: true, disposalThreshold: 50, configuredBy: null })
    expect(DEFAULT_SETTINGS.weights.map((w) => w.weight)).toStrictEqual([0.2, 0.2, 0.2, 0.2, 0.2])
  })

  it('시드는 v1이 활성 상태다', () => {
    expect(storeWithSeed().getActive()).toMatchObject({ profileVersion: 'v1', isDefault: false, disposalThreshold: 60 })
  })

  it('응답을 고쳐도 저장소는 바뀌지 않는다', () => {
    const store = storeWithSeed()
    store.getActive().weights[0].weight = 1
    expect(store.getActive().weights[0].weight).toBe(0.3)
  })
})

describe('평가 설정 저장', () => {
  it('새 버전으로 저장하고 활성화한다', () => {
    const store = storeWithSeed()
    const response = store.update(VALID)
    expect(response).toStrictEqual({
      profileVersion: 'v2',
      isDefault: false,
      disposalThreshold: 55,
      weights: VALID.weights,
      configuredBy: 1,
      configuredAt: '2026-11-27T12:00:00',
    })
    expect(store.getActive()).toStrictEqual(response)
    expect(store.update(VALID).profileVersion).toBe('v3')
  })

  it('가중치를 어떤 순서로 보내도 평가축 순서로 정리한다', () => {
    const response = storeWithSeed().update({ ...VALID, weights: [...VALID.weights].reverse() })
    expect(response.weights.map((w) => w.criterion)).toStrictEqual([
      'DEMAND',
      'RARITY',
      'DUPLICATION',
      'CONTENT_VALIDITY',
      'PHYSICAL_CONDITION',
    ])
  })

  it('부동소수 오차가 있는 합계(0.1 + 0.2 …)도 정확히 1.0으로 판단한다', () => {
    const weights = [0.1, 0.2, 0.3, 0.3, 0.1]
    const request = { disposalThreshold: 50, weights: VALID.weights.map((w, i) => ({ ...w, weight: weights[i] })) }
    expect(storeWithSeed().update(request).profileVersion).toBe('v2')
  })

  it.each([
    ['합계가 1.0을 넘으면', [0.4, 0.2, 0.2, 0.15, 0.15], '가중치의 합은 1.0 이어야 합니다. (현재 1.1)'],
    ['합계가 1.0보다 작으면', [0.2, 0.2, 0.2, 0.15, 0.15], '가중치의 합은 1.0 이어야 합니다. (현재 0.9)'],
  ])('%s EVAL_001이고 저장하지 않는다', (_, weights, message) => {
    const store = storeWithSeed()
    const error = catchError(() =>
      store.update({ disposalThreshold: 50, weights: VALID.weights.map((w, i) => ({ ...w, weight: weights[i] })) }),
    )
    expect(error).toMatchObject({ status: 400, code: ERROR_CODE.EVALUATION_INVALID_WEIGHTS, message })
    expect(store.getActive().profileVersion).toBe('v1')
  })

  it('평가축이 빠지거나 중복되면 EVAL_001이다', () => {
    const store = storeWithSeed()
    expect(catchError(() => store.update({ ...VALID, weights: VALID.weights.slice(1) })).message).toBe(
      '모든 평가축의 가중치가 필요합니다. 누락: DEMAND',
    )
    expect(
      catchError(() => store.update({ ...VALID, weights: [...VALID.weights, VALID.weights[0]] })).message,
    ).toBe('평가축이 중복되었습니다: DEMAND')
  })

  it.each([
    ['기준 점수가 범위를 벗어나면', { ...VALID, disposalThreshold: 100.01 }, 'disposalThreshold'],
    ['기준 점수가 소수 셋째 자리이면', { ...VALID, disposalThreshold: 55.555 }, 'disposalThreshold'],
    ['가중치가 음수이면', { ...VALID, weights: [{ criterion: 'DEMAND', weight: -0.1 }, ...VALID.weights.slice(1)] }, 'weights[0].weight'],
    ['가중치가 소수 다섯째 자리이면', { ...VALID, weights: [{ criterion: 'DEMAND', weight: 0.12345 }, ...VALID.weights.slice(1)] }, 'weights[0].weight'],
    ['가중치 목록이 비어 있으면', { ...VALID, weights: [] }, 'weights'],
  ] as [string, EvaluationSettingsUpdateRequest, string][])('%s COMMON_001이다', (_, request, field) => {
    const error = catchError(() => storeWithSeed().update(request))
    expect(error).toMatchObject({ status: 400, code: ERROR_CODE.INVALID_INPUT })
    expect(error.errors.map((e) => e.field)).toContain(field)
  })

  it('기준 점수의 경계값(0, 100)과 소수 둘째 자리는 허용한다', () => {
    const store = storeWithSeed()
    expect(store.update({ ...VALID, disposalThreshold: 0 }).disposalThreshold).toBe(0)
    expect(store.update({ ...VALID, disposalThreshold: 100 }).disposalThreshold).toBe(100)
    expect(store.update({ ...VALID, disposalThreshold: 62.75 }).disposalThreshold).toBe(62.75)
  })
})
