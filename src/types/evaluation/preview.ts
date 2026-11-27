// 기준 변경 시 예상 영향(예상 폐기 후보 수)을 계산하기 위한 데이터.
// Backend에는 아직 이 API가 없다. Mock 전용 계약이며, 실제 연동 방식(서버 계산 또는 평가축 점수 조회)은 후속 협의로 정한다.
import type { CriterionType } from './settings'

/** 도서 한 권의 평가축별 점수(0~100, 높을수록 폐기 검토 필요성이 크다). 점수가 없는 평가축은 null이다. */
export interface PreviewBookScores {
  bookId: number
  scores: Record<CriterionType, number | null>
}

/** 미리보기 대상(최근 종합 평가를 실행한 자료실)과 그 도서들의 평가축별 점수 */
export interface DisposalPreviewResponse {
  zone: string
  books: PreviewBookScores[]
}
