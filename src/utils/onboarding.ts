const KEY = 'libsync:onboarding-done'

// 저장소를 쓸 수 없는 환경에서도 현재 세션 동안은 완료 상태를 유지하기 위한 메모리 값
let doneInMemory = false

export function hasSeenOnboarding(): boolean {
  if (doneInMemory) return true
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingDone(): void {
  doneInMemory = true
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // 저장소를 쓸 수 없으면 메모리 값만 유지 (새로고침하면 다시 표시)
  }
}
