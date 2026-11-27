import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODE } from '@/api/ApiError'
import { getPreviewScores } from '@/mocks/evaluation/previewScores'
import { DEFAULT_SETTINGS, SEED_PROFILE } from '@/mocks/evaluation/settingsStore'
import type { PreviewBookScores } from '@/types/evaluation/preview'
import type { EvaluationSettingsResponse } from '@/types/evaluation/settings'
import {
  DEFAULT_DRAFT,
  SAVE_ERROR_TEXT,
  countDisposalCandidates,
  diffDraft,
  formatConfiguredDate,
  isSameDraft,
  previewDeltaText,
  saveButtonState,
  saveErrorText,
  signed,
  toDraft,
  toRequest,
  weightSum,
  weightSumLabel,
  type SettingsDraft,
} from './settingsView'

const SEED_RESPONSE: EvaluationSettingsResponse = {
  ...SEED_PROFILE,
  isDefault: false,
  weights: SEED_PROFILE.weights.map((w) => ({ ...w })),
}

const SEED_DRAFT: SettingsDraft = {
  threshold: 60,
  weights: { DEMAND: 30, RARITY: 20, DUPLICATION: 20, CONTENT_VALIDITY: 15, PHYSICAL_CONDITION: 15 },
}

function book(scores: Partial<PreviewBookScores['scores']>, fill = 0): PreviewBookScores {
  return {
    bookId: 1,
    scores: { DEMAND: fill, RARITY: fill, DUPLICATION: fill, CONTENT_VALIDITY: fill, PHYSICAL_CONDITION: fill, ...scores },
  }
}

describe('편집 단위 변환', () => {
  it('응답의 가중치(0~1)를 %로 바꾼다', () => {
    expect(toDraft(SEED_RESPONSE)).toStrictEqual(SEED_DRAFT)
    expect(toDraft(DEFAULT_SETTINGS)).toStrictEqual(DEFAULT_DRAFT)
  })

  it('요청은 모든 평가축을 평가축 순서대로 0~1로 보낸다', () => {
    expect(toRequest(SEED_DRAFT)).toStrictEqual({ disposalThreshold: 60, weights: SEED_RESPONSE.weights })
  })

  it('정수가 아닌 값은 반올림하고, 응답에 없는 평가축은 0%다', () => {
    const draft = toDraft({ ...SEED_RESPONSE, disposalThreshold: 62.5, weights: [{ criterion: 'DEMAND', weight: 0.3333 }] })
    expect(draft.threshold).toBe(63)
    expect(draft.weights).toStrictEqual({ DEMAND: 33, RARITY: 0, DUPLICATION: 0, CONTENT_VALIDITY: 0, PHYSICAL_CONDITION: 0 })
  })
})

describe('가중치 합계', () => {
  it('합계를 구하고 100%가 아니면 초과·부족을 표시한다', () => {
    expect(weightSum(SEED_DRAFT)).toBe(100)
    expect(weightSumLabel(100)).toStrictEqual({ ok: true, text: '100% 정상' })
    expect(weightSumLabel(110)).toStrictEqual({ ok: false, text: '110% (10% 초과)' })
    expect(weightSumLabel(85)).toStrictEqual({ ok: false, text: '85% (15% 부족)' })
  })
})

describe('변경 내역', () => {
  it('같은 값이면 변경이 없다', () => {
    expect(isSameDraft(SEED_DRAFT, structuredClone(SEED_DRAFT))).toBe(true)
    expect(diffDraft(SEED_DRAFT, SEED_DRAFT)).toStrictEqual({ threshold: null, weights: [] })
  })

  it('바뀐 기준 점수와 평가축만 평가축 순서로 돌려준다', () => {
    const next: SettingsDraft = { threshold: 55, weights: { ...SEED_DRAFT.weights, DEMAND: 35, DUPLICATION: 15 } }
    expect(isSameDraft(SEED_DRAFT, next)).toBe(false)
    expect(diffDraft(SEED_DRAFT, next)).toStrictEqual({
      threshold: { from: 60, to: 55 },
      weights: [
        { criterion: 'DEMAND', delta: 5 },
        { criterion: 'DUPLICATION', delta: -5 },
      ],
    })
  })

  it('부호를 붙여 표시한다', () => {
    expect(signed(5, '%')).toBe('+5%')
    expect(signed(-5, '점')).toBe('-5점')
    expect(signed(0, '권')).toBe('0권')
    expect(previewDeltaText(12, 12)).toBe('(변동 없음)')
    expect(previewDeltaText(12, 18)).toBe('(+6권)')
    expect(previewDeltaText(12, 9)).toBe('(-3권)')
  })
})

describe('예상 폐기 후보 수', () => {
  it('종합 점수가 기준 점수 이상이면 후보다 (경계값 포함)', () => {
    const draft = { ...DEFAULT_DRAFT, threshold: 50 }
    expect(countDisposalCandidates([book({}, 50)], draft)).toBe(1)
    expect(countDisposalCandidates([book({}, 49)], draft)).toBe(0)
  })

  it('종합 점수의 소수 부분까지 비교한다', () => {
    // 100×0.01 + 99×0.99 = 99.01 → 기준 99 이상, 100 미만
    const weights = { DEMAND: 1, RARITY: 99, DUPLICATION: 0, CONTENT_VALIDITY: 0, PHYSICAL_CONDITION: 0 }
    const b = book({ DEMAND: 100, RARITY: 99 })
    expect(countDisposalCandidates([b], { threshold: 99, weights })).toBe(1)
    expect(countDisposalCandidates([b], { threshold: 100, weights })).toBe(0)
  })

  it('부동소수 오차 없이 계산한다 (0.1 + 0.2 형태의 가중치)', () => {
    const weights = { DEMAND: 10, RARITY: 20, DUPLICATION: 70, CONTENT_VALIDITY: 0, PHYSICAL_CONDITION: 0 }
    // 30×0.1 + 30×0.2 + 30×0.7 = 30 (부동소수로는 29.999…)
    expect(countDisposalCandidates([book({}, 30)], { threshold: 30, weights })).toBe(1)
  })

  it('가중치가 0보다 큰 평가축의 점수가 없으면 평가 불가로 제외하고, 가중치가 0이면 계산한다', () => {
    const missing = book({ RARITY: null }, 100)
    expect(countDisposalCandidates([missing], DEFAULT_DRAFT)).toBe(0)
    const noRarity = { threshold: 50, weights: { ...DEFAULT_DRAFT.weights, RARITY: 0, DEMAND: 40 } }
    expect(countDisposalCandidates([missing], noRarity)).toBe(1)
  })

  it('Mock fixture는 기준을 낮추거나 수요성 가중치를 올리면 후보가 늘어난다', () => {
    const { books } = getPreviewScores()
    const current = countDisposalCandidates(books, SEED_DRAFT)
    const next = countDisposalCandidates(books, {
      threshold: 55,
      weights: { ...SEED_DRAFT.weights, DEMAND: 35, DUPLICATION: 15 },
    })
    expect(current).toBeGreaterThan(0)
    expect(next).toBeGreaterThan(current)
  })
})

describe('저장 버튼', () => {
  it('합계 오류이면 잠기고 이유를 보여 준다', () => {
    expect(saveButtonState({ dirty: true, sumOk: false, pending: false })).toStrictEqual({
      disabled: true,
      label: '저장 (합계 100% 필요)',
      locked: true,
    })
  })

  it('변경이 없거나 저장 중이면 누를 수 없다', () => {
    expect(saveButtonState({ dirty: false, sumOk: true, pending: false })).toMatchObject({ disabled: true, label: '저장' })
    expect(saveButtonState({ dirty: true, sumOk: true, pending: true })).toMatchObject({ disabled: true, label: '저장 중…' })
    expect(saveButtonState({ dirty: true, sumOk: true, pending: false })).toMatchObject({ disabled: false, locked: false })
  })
})

describe('저장 오류 문구', () => {
  const apiError = (status: number, code: string) => new ApiError(status, { code, message: 'x', errors: [] })

  it.each([
    [apiError(400, ERROR_CODE.EVALUATION_INVALID_WEIGHTS), SAVE_ERROR_TEXT.invalidWeights],
    [apiError(403, ERROR_CODE.FORBIDDEN), SAVE_ERROR_TEXT.forbidden],
    [apiError(400, ERROR_CODE.INVALID_INPUT), SAVE_ERROR_TEXT.invalidInput],
    [apiError(500, ERROR_CODE.INTERNAL_SERVER_ERROR), SAVE_ERROR_TEXT.generic],
    [new Error('network'), SAVE_ERROR_TEXT.generic],
  ])('%s', (error, text) => {
    expect(saveErrorText(error)).toBe(text)
  })

  it('오프라인이면 네트워크 안내가 우선이다', () => {
    expect(saveErrorText(apiError(400, ERROR_CODE.EVALUATION_INVALID_WEIGHTS), false)).toBe(SAVE_ERROR_TEXT.offline)
  })
})

describe('저장 시각 표시', () => {
  it('날짜만 점으로 구분해 보여 준다', () => {
    expect(formatConfiguredDate('2026-11-09T10:00:00')).toBe('2026.11.09')
    expect(formatConfiguredDate(null)).toBeNull()
  })
})
