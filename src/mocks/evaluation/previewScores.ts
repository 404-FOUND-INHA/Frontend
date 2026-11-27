import { SEED_ZONES } from '@/mocks/scan/seed'
import { CRITERION_TYPES, type CriterionType } from '@/types/evaluation/settings'
import type { DisposalPreviewResponse, PreviewBookScores } from '@/types/evaluation/preview'

// 예상 영향 미리보기용 평가축 점수 fixture. 실제 평가를 실행하지 않고 고정 시드의 의사 난수로 만든다.
// 점수는 정수(0~100)이고, 일부 도서는 점수가 없는 평가축이 있어 그 축의 가중치가 0보다 크면 평가 불가가 된다.

const BOOK_COUNT = 120
const FIRST_BOOK_ID = 1001
/** 점수가 없는 평가축: [도서 ID, 평가축] */
const MISSING: [number, CriterionType][] = [
  [1007, 'RARITY'],
  [1042, 'CONTENT_VALIDITY'],
  [1088, 'RARITY'],
]

/** 같은 시드면 항상 같은 수열을 만드는 선형 합동 생성기 */
function lcg(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

function buildBooks(): PreviewBookScores[] {
  const next = lcg(20261127)
  return Array.from({ length: BOOK_COUNT }, (_, i) => {
    const bookId = FIRST_BOOK_ID + i
    // 도서마다 폐기 경향(base)을 정하고 평가축마다 흔들어, 평가축 점수끼리 어느 정도 상관이 있게 한다.
    const base = next() ** 1.5 * 0.65 + 0.05
    const score = () => Math.min(100, Math.max(0, Math.round((base + (next() - 0.5) * 0.5) * 100)))
    const scores = Object.fromEntries(CRITERION_TYPES.map((type) => [type, score()])) as Record<CriterionType, number | null>
    for (const [id, type] of MISSING) if (id === bookId) scores[type] = null
    return { bookId, scores }
  })
}

const PREVIEW: DisposalPreviewResponse = { zone: SEED_ZONES.HUMANITIES, books: buildBooks() }

/** 호출할 때마다 새 복사본을 돌려준다. */
export function getPreviewScores(): DisposalPreviewResponse {
  return { zone: PREVIEW.zone, books: PREVIEW.books.map((b) => ({ bookId: b.bookId, scores: { ...b.scores } })) }
}
