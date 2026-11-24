import { describe, expect, it } from 'vitest'
import { seoulDate, seoulDateTime } from './seoulTime'

describe('seoulDate / seoulDateTime', () => {
  it('UTC와 서울의 날짜가 다른 시각(UTC 15:00 이후)은 서울 날짜로 변환한다', () => {
    const t = Date.parse('2026-06-15T15:30:00Z') // 서울은 이미 6월 16일 00:30
    expect(seoulDate(t)).toBe('2026-06-16')
    expect(seoulDateTime(t)).toBe('2026-06-16T00:30:00')
  })

  it('서울 날짜가 바뀌기 직전과 직후를 구분한다', () => {
    expect(seoulDate(Date.parse('2026-06-16T14:59:59Z'))).toBe('2026-06-16')
    expect(seoulDateTime(Date.parse('2026-06-16T14:59:59Z'))).toBe('2026-06-16T23:59:59')
    expect(seoulDate(Date.parse('2026-06-16T15:00:00Z'))).toBe('2026-06-17')
  })

  it('자정을 24시가 아닌 00시로 표기한다', () => {
    expect(seoulDateTime(Date.parse('2026-12-31T15:00:00Z'))).toBe('2027-01-01T00:00:00')
  })

  it('UTC 기준 같은 날짜 안에서도 서울 시각 오프셋(+9)이 적용된다', () => {
    expect(seoulDateTime(Date.parse('2026-11-24T03:00:00Z'))).toBe('2026-11-24T12:00:00')
  })
})
