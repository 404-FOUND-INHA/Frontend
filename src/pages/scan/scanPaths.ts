// 장서점검 화면 경로와 이동 활성화 플래그. 생성(4단계)·상세(5단계) 라우트가 모두 연결되어 둘 다 켜져 있다.

export const scanPaths = {
  list: '/scan',
  create: '/scan/new',
  detail: (id: number) => `/scan/${id}`,
}

export const SCAN_NAV_ENABLED: { create: boolean; detail: boolean } = {
  create: true,
  detail: true,
}

// 목록에서 FAB·카드로 들어왔음을 생성·상세 화면에 알리는 라우터 state. 있으면 뒤로가기가 목록(필터 유지)으로 돌아가고,
// 없으면(주소 직접 입력, 생성 성공 후 상세 이동 등) /scan(전체 목록)으로 안전하게 이동한다. history.state에 저장되어 새로고침 후에도 유지된다.
export const FROM_LIST_STATE = { fromList: true } as const

export function isFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { fromList?: unknown }).fromList === true
}
