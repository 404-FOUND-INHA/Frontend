// 장서점검 화면 경로. 생성·상세 화면이 구현되기 전에는 이동 링크를 만들지 않는다(없는 경로로 가면 404가 되기 때문).
// create는 4단계에서 켰다. 5단계(상세)에서 detail을 true로 바꾼다(라우트 추가와 함께).

export const scanPaths = {
  list: '/scan',
  create: '/scan/new',
  detail: (id: number) => `/scan/${id}`,
}

export const SCAN_NAV_ENABLED: { create: boolean; detail: boolean } = {
  create: true,
  detail: false,
}

// 목록에서 FAB로 들어왔음을 생성 화면에 알리는 라우터 state. 있으면 뒤로가기가 목록(필터 유지)으로 돌아가고,
// 없으면(주소 직접 입력 등 진입 경로가 불명확) /scan으로 안전하게 이동한다. history.state에 저장되어 새로고침 후에도 유지된다.
export const FROM_LIST_STATE = { fromList: true } as const

export function isFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { fromList?: unknown }).fromList === true
}
