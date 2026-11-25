import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'libsync:onboarding-done'

// onboarding.ts는 모듈 수준 변수(doneInMemory)를 가지므로,
// 테스트마다 모듈을 새로 불러와 상태가 다른 테스트로 새지 않게 한다.
async function loadFresh() {
  vi.resetModules()
  return import('./onboarding')
}

// 실행 환경의 localStorage 존재 여부(Node 버전에 따라 내장 구현이 있을 수 있음)와 관계없이
// 결과가 달라지지 않도록, 매 테스트에서 localStorage를 명시적으로 교체한다.
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function stubStorage(storage: Partial<Storage>) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
}

function stubUnavailableStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('storage unavailable')
    },
    configurable: true,
  })
}

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

describe('onboarding 유틸', () => {
  // 순서 의미: 아래 첫 테스트가 메모리 상태를 true로 만든다.
  // 격리가 깨지면 바로 다음 테스트(false 기대)가 실패한다.
  it('저장소에 쓸 수 없어도 현재 세션에서는 완료 상태를 메모리에 유지한다', async () => {
    stubStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    const { hasSeenOnboarding, markOnboardingDone } = await loadFresh()

    expect(hasSeenOnboarding()).toBe(false)
    expect(() => markOnboardingDone()).not.toThrow()
    expect(hasSeenOnboarding()).toBe(true)
  })

  it('저장소 접근이 불가능하고 완료한 적이 없으면 false를 반환한다 (이전 테스트의 메모리 상태가 없어야 함)', async () => {
    stubUnavailableStorage()
    const { hasSeenOnboarding } = await loadFresh()

    expect(hasSeenOnboarding()).toBe(false)
  })

  it('저장소 접근이 불가능해도 완료 처리는 예외 없이 메모리에 반영된다', async () => {
    stubUnavailableStorage()
    const { hasSeenOnboarding, markOnboardingDone } = await loadFresh()

    expect(() => markOnboardingDone()).not.toThrow()
    expect(hasSeenOnboarding()).toBe(true)
  })

  it("저장소 값이 '1'일 때만 완료로 판단한다", async () => {
    stubStorage({ getItem: (key) => (key === KEY ? '1' : null) })
    const done = await loadFresh()
    expect(done.hasSeenOnboarding()).toBe(true)

    stubStorage({ getItem: () => 'true' })
    const notDone = await loadFresh()
    expect(notDone.hasSeenOnboarding()).toBe(false)
  })

  it('저장소를 쓸 수 있으면 완료 상태를 저장한다', async () => {
    const setItem = vi.fn()
    stubStorage({ getItem: () => null, setItem })
    const { markOnboardingDone } = await loadFresh()

    markOnboardingDone()

    expect(setItem).toHaveBeenCalledExactlyOnceWith(KEY, '1')
  })
})
