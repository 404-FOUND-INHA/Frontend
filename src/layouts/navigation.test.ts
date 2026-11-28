import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, getActiveNavKey } from './navigation'

describe('NAV_ITEMS', () => {
  it('홈, 점검, 서가, 설정 순서다', () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(['홈', '점검', '서가', '설정'])
  })

  it('아직 연결되지 않은 설정에만 이동 경로가 없다', () => {
    expect(NAV_ITEMS.map((item) => [item.key, item.to])).toEqual([
      ['home', '/'],
      ['scan', '/scan'],
      ['shelf', '/shelf'],
      ['settings', undefined],
    ])
  })
})

describe('getActiveNavKey', () => {
  it('홈은 / 에서만 활성이다', () => {
    expect(getActiveNavKey('/')).toBe('home')
  })

  it.each(['/scan', '/scan/', '/scan/new', '/scan/12', '/scan/12/anything'])(
    '점검 탭은 %s 에서 활성이다 (목록·생성·상세를 오가도 유지)',
    (pathname) => {
      expect(getActiveNavKey(pathname)).toBe('scan')
    },
  )

  it('점검 탭 이름으로 시작할 뿐인 다른 경로에서는 활성이 아니다', () => {
    expect(getActiveNavKey('/scanner')).toBeNull()
    expect(getActiveNavKey('/scan-old')).toBeNull()
  })

  it('경로 대소문자는 라우터 기본 규칙(구분하지 않음)을 따른다', () => {
    expect(getActiveNavKey('/Scan/12')).toBe('scan')
  })

  it('서가 탭은 /shelf에서 활성이고, 회차의 배치도에서는 점검 탭이 활성이다', () => {
    expect(getActiveNavKey('/shelf')).toBe('shelf')
    expect(getActiveNavKey('/scan/3/shelf-map')).toBe('scan')
  })

  it.each(['/없는경로', '/login', '/shelves', '/settings', ''])(
    '어느 탭에도 해당하지 않는 경로(%s)는 활성 탭이 없다',
    (pathname) => {
      expect(getActiveNavKey(pathname)).toBeNull()
    },
  )

  it('연결되지 않은 설정 탭은 어떤 경로에서도 활성이 되지 않는다', () => {
    for (const pathname of ['/', '/scan', '/shelf', '/settings', '/shelves/1']) {
      expect(getActiveNavKey(pathname)).not.toBe('settings')
    }
  })
})
