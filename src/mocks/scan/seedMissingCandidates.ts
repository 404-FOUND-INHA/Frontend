import type { MissingCandidateStatus } from '@/types/scan/missingCandidate'
import { consecutiveMissingCount } from './finalize'
import { SEED_LIBRARIAN } from './seedReview'
import type { MockData, MockMissingCandidate } from './types'

// 과거 완료 회차의 소재불명 후보 시나리오. 확정 당시의 원장은 알 수 없으므로 지금 원장으로 산출하지 않고,
// 어느 회차에서 어느 도서가 후보였고 이후 어떻게 확인됐는지를 여기에 직접 정한다.
// 여기에 없는 완료 회차는 후보가 0건이다. 도서는 새로 만들지 않고 그 회차에서 관측되지 않은 기존 도서를 쓴다.

interface SeedCandidate {
  bookId: number
  status: MissingCandidateStatus
  /** 확인 기록. 확인 전(PENDING)에는 없다. */
  reviewedAt?: string
  note?: string
}

const SCENARIOS: Record<number, SeedCandidate[]> = {
  // 2025년 2학기 인문과학: 세 도서 모두 다음 회차(5)에서 다시 관측된다.
  6: [
    { bookId: 255, status: 'FOUND', reviewedAt: '2025-12-17T10:00:00', note: '옆 서가에서 찾음' },
    { bookId: 291, status: 'RESOLVED', reviewedAt: '2025-12-18T11:00:00', note: '반납 처리 누락 확인' },
    { bookId: 327, status: 'LOST_CANDIDATE', reviewedAt: '2025-12-19T15:00:00' },
  ],
  // 2025년 2학기 자연과학: C-01의 소재불명 도서. 회차 3을 확정하면 연속 2회가 된다.
  121: [{ bookId: 422, status: 'NOT_FOUND', reviewedAt: '2025-12-17T14:00:00' }],
  // 2026년 1학기 인문과학: 확인 전
  5: [
    { bookId: 330, status: 'PENDING' },
    { bookId: 332, status: 'PENDING' },
  ],
}

/** 확정 순서대로 만든다. 후보 ID는 그 순서이고, 연속 미발견 횟수는 회차 확정과 같은 규칙으로 정한다. */
export function buildSeedMissingCandidates(
  source: Pick<MockData, 'sessions' | 'sessionShelves' | 'books'>,
): MockMissingCandidate[] {
  const completed = source.sessions
    .flatMap((s) => (s.finalizedAt === null ? [] : [{ sessionId: s.id, finalizedAt: s.finalizedAt }]))
    .sort((a, b) => a.finalizedAt.localeCompare(b.finalizedAt) || a.sessionId - b.sessionId)

  const candidates: MockMissingCandidate[] = []
  for (const session of completed) {
    for (const { bookId, status, reviewedAt = null, note = null } of SCENARIOS[session.sessionId] ?? []) {
      const expectedShelfId = source.books.find((b) => b.id === bookId)?.expectedShelfId
      if (expectedShelfId == null) throw new Error(`후보 시드의 도서 ${bookId}에 예상 서가가 없습니다`)
      candidates.push({
        id: candidates.length + 1,
        sessionId: session.sessionId,
        bookId,
        expectedShelfId,
        consecutiveMissingCount: consecutiveMissingCount(
          { ...source, missingCandidates: candidates },
          session,
          { bookId, expectedShelfId },
        ),
        status,
        reviewedBy: status === 'PENDING' ? null : SEED_LIBRARIAN.id,
        reviewedAt,
        note,
        createdAt: session.finalizedAt,
      })
    }
  }
  return candidates
}
