import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetEvaluationSettingsStore } from '@/mocks/evaluation/settingsStore'
import type { EvaluationSettingsUpdateRequest } from '@/types/evaluation/settings'
import { evaluationKeys } from './queryKeys'
import { evaluationSettingsQueryOptions } from './useEvaluationSettings'
import { updateEvaluationSettingsMutationOptions } from './useUpdateEvaluationSettings'

const REQUEST: EvaluationSettingsUpdateRequest = {
  disposalThreshold: 55,
  weights: [
    { criterion: 'DEMAND', weight: 0.35 },
    { criterion: 'RARITY', weight: 0.2 },
    { criterion: 'DUPLICATION', weight: 0.15 },
    { criterion: 'CONTENT_VALIDITY', weight: 0.15 },
    { criterion: 'PHYSICAL_CONDITION', weight: 0.15 },
  ],
}

let client: QueryClient

beforeEach(() => {
  resetEvaluationSettingsStore()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('평가 설정 Query', () => {
  it('조회 결과를 settings 키에 둔다', async () => {
    const data = await client.fetchQuery(evaluationSettingsQueryOptions())
    expect(data.profileVersion).toBe('v1')
    expect(client.getQueryData(evaluationKeys.settings())).toBe(data)
  })

  it('저장에 성공하면 응답으로 캐시를 바꾸고 관찰 중인 화면도 새 값을 받는다', async () => {
    const observer = new QueryObserver(client, evaluationSettingsQueryOptions())
    const unsubscribe = observer.subscribe(() => {})
    await client.fetchQuery(evaluationSettingsQueryOptions())

    const mutation = new MutationObserver(client, updateEvaluationSettingsMutationOptions(client))
    const response = await mutation.mutate(REQUEST)

    expect(response.profileVersion).toBe('v2')
    expect(client.getQueryData(evaluationKeys.settings())).toStrictEqual(response)
    expect(observer.getCurrentResult().data).toStrictEqual(response)
    unsubscribe()
  })

  it('저장에 실패하면 캐시는 그대로다', async () => {
    const before = await client.fetchQuery(evaluationSettingsQueryOptions())
    const mutation = new MutationObserver(client, updateEvaluationSettingsMutationOptions(client))
    await expect(mutation.mutate({ ...REQUEST, weights: REQUEST.weights.slice(1) })).rejects.toThrow()
    expect(client.getQueryData(evaluationKeys.settings())).toBe(before)
  })
})
