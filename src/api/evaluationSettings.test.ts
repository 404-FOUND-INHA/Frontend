import { beforeEach, describe, expect, it } from 'vitest'
import { getEvaluationSettingsStore, resetEvaluationSettingsStore } from '@/mocks/evaluation/settingsStore'
import { ApiError, ERROR_CODE } from './ApiError'
import { getDisposalPreviewScores, getEvaluationSettings, updateEvaluationSettings } from './evaluationSettings'

beforeEach(() => {
  resetEvaluationSettingsStore({ now: () => Date.parse('2026-11-27T03:00:00Z') })
})

describe('평가 설정 API', () => {
  it('조회는 저장소의 활성 설정 그대로다', async () => {
    await expect(getEvaluationSettings()).resolves.toStrictEqual(getEvaluationSettingsStore().getActive())
  })

  it('저장하면 이후 조회에 새 버전이 보인다', async () => {
    const saved = await updateEvaluationSettings({
      disposalThreshold: 55,
      weights: [
        { criterion: 'DEMAND', weight: 0.2 },
        { criterion: 'RARITY', weight: 0.2 },
        { criterion: 'DUPLICATION', weight: 0.2 },
        { criterion: 'CONTENT_VALIDITY', weight: 0.2 },
        { criterion: 'PHYSICAL_CONDITION', weight: 0.2 },
      ],
    })
    expect(saved.profileVersion).toBe('v2')
    await expect(getEvaluationSettings()).resolves.toStrictEqual(saved)
  })

  it('저장 실패는 저장소의 ApiError 그대로다', async () => {
    const error = await updateEvaluationSettings({ disposalThreshold: 50, weights: [{ criterion: 'DEMAND', weight: 1 }] }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, code: ERROR_CODE.EVALUATION_INVALID_WEIGHTS })
  })

  it('미리보기 점수는 매번 새 복사본이고 내용은 같다', async () => {
    const a = await getDisposalPreviewScores()
    const b = await getDisposalPreviewScores()
    expect(a).toStrictEqual(b)
    expect(a).not.toBe(b)
    expect(a.books).toHaveLength(120)
    a.books[0].scores.DEMAND = -1
    expect((await getDisposalPreviewScores()).books[0].scores.DEMAND).not.toBe(-1)
  })
})
