const KEY = 'libsync:onboarding-done'

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // 저장소를 쓸 수 없으면 무시 (다음 방문 때 다시 표시)
  }
}
