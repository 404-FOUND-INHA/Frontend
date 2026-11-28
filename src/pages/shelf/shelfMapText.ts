import type { ShelfMapEntry, ShelfMapEvaluation, ShelfMarker, Source } from './shelfMapModel'

// 서가 배치도의 표시 문구(순수 함수). 알 수 없는 값을 0건이나 정상으로 쓰지 않는다.

export const MARKER_LABEL: Record<ShelfMarker, string> = {
  normal: '정상',
  misplaced: '오배치',
  missing: '소재불명',
  reviewRequired: '검토 필요',
  disposal: '폐기 검토',
}

/** 범례 순서 */
export const LEGEND_MARKERS: readonly ShelfMarker[] = ['normal', 'misplaced', 'missing', 'reviewRequired', 'disposal']

/** 요약 문구를 정하는 데 필요한 조회 상태 */
export interface ShelfMapStatus {
  analysis: Source<unknown>['status']
  missing: Source<unknown>['status']
  disposal: Source<unknown>['status']
  evaluation: ShelfMapEvaluation
}

export interface SummaryItem {
  /** 있으면 해당 색의 표시를 붙인다. */
  marker?: ShelfMarker
  text: string
}

/** 서가의 점검 상태. 관측이 있는 서가는 건수가 상태를 말하므로 null이다. */
function inspectionText({ inspection }: ShelfMapEntry, status: ShelfMapStatus): string | null {
  switch (inspection) {
    case 'observed':
      return null
    case 'noObservation':
      return '관측 없음'
    case 'waiting':
      return '수신 대기'
    case 'notTargeted':
      return '점검 대상 아님'
    case 'unknown':
      return status.analysis === 'loading' ? '불러오는 중' : '분석 확인 불가'
    case 'noSession':
      return '점검 이력 없음'
  }
}

/** 건수를 알 수 없는 후보 분류. 확정 전(산출 대상 아님)은 화면 위쪽에서 알린다. */
function unknownCandidateTexts({ disposal }: ShelfMapEntry, status: ShelfMapStatus): string[] {
  const texts: string[] = []
  if ([status.missing, status.disposal, status.evaluation].includes('loading')) texts.push('불러오는 중')
  if (status.missing === 'error') texts.push(`${MARKER_LABEL.missing} 확인 불가`)
  if (!disposal) {
    // 평가 현황을 모르거나 평가한 결과가 없으면 후보가 0권인지 알 수 없다.
    if (status.disposal === 'error' || status.evaluation === 'error') texts.push(`${MARKER_LABEL.disposal} 확인 불가`)
    else if (status.evaluation === 'none' || status.evaluation === 'allNotEvaluable') {
      texts.push(`${MARKER_LABEL.disposal} 미산출`)
    }
  }
  return texts
}

/**
 * 선택한 서가의 요약: 점검 상태와 0건이 아닌 분류의 건수. 알 수 없는 분류는 0건이나 정상으로 읽히지 않게 짧게
 * 알리고, 쓸 것이 없는데 정상 표시도 없는 서가는 판정 보류다.
 */
export function shelfSummary(entry: ShelfMapEntry, status: ShelfMapStatus): SummaryItem[] {
  if (entry.markers.includes('normal')) return [{ marker: 'normal', text: MARKER_LABEL.normal }]

  const counts = [
    ['misplaced', entry.analysis?.misplaced, '건'],
    ['reviewRequired', entry.analysis?.reviewRequired, '건'],
    ['missing', entry.missing?.total, '권'],
    ['disposal', entry.disposal, '권'],
  ] as const
  const state = inspectionText(entry, status)
  const unknown = entry.inspection === 'noSession' ? [] : unknownCandidateTexts(entry, status)
  const items: SummaryItem[] = [
    ...(state ? [{ text: state }] : []),
    ...counts.flatMap(([marker, count, unit]) =>
      count ? [{ marker, text: `${MARKER_LABEL[marker]} ${count}${unit}` }] : [],
    ),
    ...unknown.filter((text) => text !== state).map((text) => ({ text })),
  ]
  return items.length > 0 ? items : [{ text: '판정 보류' }]
}

/** 지도의 서가를 읽어 주는 이름. 색 표시의 내용을 글로 담는다. */
export function shelfAccessibleName(entry: ShelfMapEntry, status: ShelfMapStatus): string {
  const markers = entry.markers.map((marker) => MARKER_LABEL[marker])
  return [`${entry.shelfCode} 서가`, ...markers, inspectionText(entry, status)].filter(Boolean).join(', ')
}

export function formatFloor(floorNo: number | null): string {
  if (floorNo === null) return '층 미등록'
  return floorNo < 0 ? `지하 ${-floorNo}층` : `${floorNo}층`
}
