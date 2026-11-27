// 평가 설정 API(GET/PUT /api/evaluation/settings)의 DTO 타입.
// 필드명, 타입, nullable 여부는 Backend 코드(origin/main)의 EvaluationSettingsResponse, EvaluationSettingsUpdateRequest,
// CriterionWeight, CriterionType을 따른다. BigDecimal(가중치, 기준 점수)은 JSON 숫자다.

/** 폐기 평가 기준(평가축). 응답의 weights도 이 순서다. */
export const CRITERION_TYPES = ['DEMAND', 'RARITY', 'DUPLICATION', 'CONTENT_VALIDITY', 'PHYSICAL_CONDITION'] as const

export type CriterionType = (typeof CRITERION_TYPES)[number]

/** 평가축 하나의 가중치(0~1, 소수 넷째 자리). 요청과 응답에 함께 쓴다. */
export interface CriterionWeight {
  criterion: CriterionType
  weight: number
}

/** 현재 평가 설정. 저장된 설정이 없으면 기본값이며 profileVersion이 null, isDefault가 true다. */
export interface EvaluationSettingsResponse {
  profileVersion: string | null
  isDefault: boolean
  /** 폐기 검토 후보 기준 점수(0~100, 소수 둘째 자리). 종합 점수가 이 값 이상이면 후보다. */
  disposalThreshold: number
  weights: CriterionWeight[]
  /** 저장한 사용자 ID. 기본값이면 null */
  configuredBy: number | null
  /** 저장 시각. 기본값이면 null */
  configuredAt: string | null
}

/** PUT 요청 본문. 모든 평가축의 가중치를 한 번에 보내며 합계는 1.0이어야 한다. */
export interface EvaluationSettingsUpdateRequest {
  disposalThreshold: number
  weights: CriterionWeight[]
}
