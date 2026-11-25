// 장서점검 화면 경로. 생성·상세 화면이 구현되기 전에는 이동 링크를 만들지 않는다(없는 경로로 가면 404가 되기 때문).
// 4단계(생성)에서 create를, 5단계(상세)에서 detail을 true로 바꾼다. 해당 라우트를 추가하는 변경과 함께 켠다.

export const scanPaths = {
  list: '/scan',
  create: '/scan/new',
  detail: (id: number) => `/scan/${id}`,
}

export const SCAN_NAV_ENABLED: { create: boolean; detail: boolean } = {
  create: false,
  detail: false,
}
