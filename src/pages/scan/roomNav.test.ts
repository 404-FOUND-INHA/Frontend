import { describe, expect, it } from 'vitest'
import { firstEnabledIndex, lastEnabledIndex, nextEnabledIndex, resolveActiveIndex } from './roomNav'

const r = (zone: string, hasOpenSession: boolean) => ({ zone, hasOpenSession })
const rooms = [r('a', true), r('b', false), r('c', true), r('d', false), r('e', true)]

describe('roomNav', () => {
  it('처음·끝의 선택 가능 항목', () => {
    expect(firstEnabledIndex(rooms)).toBe(1)
    expect(lastEnabledIndex(rooms)).toBe(3)
    expect(firstEnabledIndex([r('a', true)])).toBe(-1)
    expect(lastEnabledIndex([])).toBe(-1)
  })
  it('방향키 이동은 선택 불가 항목을 건너뛰고 끝에서 멈춘다', () => {
    expect(nextEnabledIndex(rooms, 1, 1)).toBe(3)
    expect(nextEnabledIndex(rooms, 3, 1)).toBe(3)
    expect(nextEnabledIndex(rooms, 3, -1)).toBe(1)
    expect(nextEnabledIndex(rooms, 1, -1)).toBe(1)
  })
  it('활성 항목: 유효하면 유지, 아니면 선택된 항목, 그것도 아니면 첫 선택 가능 항목', () => {
    expect(resolveActiveIndex(rooms, 3, '')).toBe(3)
    expect(resolveActiveIndex(rooms, 2, 'd')).toBe(3) // 활성이 선택 불가가 됨 → 선택된 자료실
    expect(resolveActiveIndex(rooms, 9, '')).toBe(1) // 목록이 줄어 범위 밖 → 첫 선택 가능
    expect(resolveActiveIndex(rooms, -1, 'a')).toBe(1) // 선택된 자료실이 선택 불가 → 첫 선택 가능
    expect(resolveActiveIndex([r('a', true)], 0, '')).toBe(-1)
  })
})
