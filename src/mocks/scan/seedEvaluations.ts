import { collectFindings } from './finalize'
import type { MockData, MockEvaluation } from './types'

// 도서 종합 평가의 고정 fixture. 평가를 실행하거나 점수를 계산·판정하지 않고, 판정과 점수를 여기에 직접 정한다.
// 평가한 회차는 위치를 확인한 도서 전부에 결과가 있다(Backend SessionBookResolver). 아래에 적지 않은 도서는 보존이다.
// 여기에 없는 회차는 평가 결과가 없다. 화면에서 확정한 회차에도 결과를 만들지 않는다.

interface SessionScenario {
  evaluatedAt: string
  /** 폐기 검토 후보: [도서 ID, 종합 점수] */
  disposal: [number, number][]
  /** 평가 불가 도서 ID. 'all'이면 모든 확인 도서 */
  notEvaluable: number[] | 'all'
}

const SCENARIOS: Record<number, SessionScenario> = {
  // 2025년 1학기 인문과학: 확인 90권이 모두 평가 불가
  7: { evaluatedAt: '2025-06-19T10:00:00', disposal: [], notEvaluable: 'all' },
  // 2025년 2학기 인문과학: 확인 102권 = 후보 0 + 보존 98 + 평가 불가 4
  6: { evaluatedAt: '2025-12-16T10:00:00', disposal: [], notEvaluable: [230, 262, 301, 331] },
  // 2025년 2학기 사회과학: 확인 38권 = 후보 2(B-02) + 보존 36. 평가 불가가 없어 정상 서가를 확인할 수 있다.
  // 다른 회차의 평가 ID가 바뀌지 않도록 가장 늦게 평가한 것으로 둔다.
  120: {
    evaluatedAt: '2026-06-23T10:00:00',
    disposal: [
      [38, 82.5],
      [41, 57],
    ],
    notEvaluable: [],
  },
  // 2026년 1학기 인문과학: 확인 111권 = 후보 23(두 페이지, 동점 포함) + 보존 85 + 평가 불가 3
  5: {
    evaluatedAt: '2026-06-22T10:00:00',
    disposal: [
      [219, 72.5], // 오배치로 확인한 도서: 현재 서가가 예상 서가와 다르다.
      [224, 91.25],
      [229, 58],
      [234, 66.75],
      [239, 88],
      [244, 50],
      [249, 79.5],
      [254, 63],
      [259, 88],
      [264, 55.5],
      [269, 94],
      [274, 61.25],
      [279, 72.5],
      [284, 52],
      [289, 83.75],
      [294, 69],
      [299, 57.25],
      [304, 76],
      [309, 53.5],
      [314, 85],
      [319, 64.5],
      [324, 59.75],
      [329, 72.5],
    ],
    notEvaluable: [222, 258, 293],
  },
}

/** 보존 도서의 점수. 도서 ID 순으로 돌려 가며 쓴다. */
const KEEP_SCORES = [12.5, 31, 47.75, 22.25, 38.5, 8, 44, 27.5]

/** 평가한 시각 순으로 만들고, 한 회차 안에서는 도서 ID 순이다. */
export function buildSeedEvaluations(data: MockData): MockEvaluation[] {
  const evaluations: MockEvaluation[] = []
  const scenarios = Object.entries(SCENARIOS).sort(([, a], [, b]) => a.evaluatedAt.localeCompare(b.evaluatedAt))
  for (const [key, { evaluatedAt, disposal, notEvaluable }] of scenarios) {
    const sessionId = Number(key)
    const confirmed = [...collectFindings(data, sessionId).keys()].sort((a, b) => a - b)
    const scores = new Map(disposal)
    const listed = [...scores.keys(), ...(notEvaluable === 'all' ? [] : notEvaluable)]
    const unknown = listed.filter((bookId) => !confirmed.includes(bookId))
    if (unknown.length > 0) throw new Error(`회차 ${sessionId}에서 확인하지 않은 도서의 평가 시드: ${unknown.join(', ')}`)

    let kept = 0
    for (const bookId of confirmed) {
      const disposalScore = scores.get(bookId)
      const result: Pick<MockEvaluation, 'candidateStatus' | 'finalScore'> =
        disposalScore !== undefined
          ? { candidateStatus: 'DISPOSAL_REVIEW', finalScore: disposalScore }
          : notEvaluable === 'all' || notEvaluable.includes(bookId)
            ? { candidateStatus: 'NOT_EVALUABLE', finalScore: null }
            : { candidateStatus: 'KEEP', finalScore: KEEP_SCORES[kept++ % KEEP_SCORES.length] }
      evaluations.push({ id: evaluations.length + 1, sessionId, bookId, ...result, profileVersion: 'default', evaluatedAt })
    }
  }
  return evaluations
}
