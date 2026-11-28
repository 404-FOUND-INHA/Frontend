import type { MockShelf } from './types'

// 서가의 지도 위치 시드. 실제 자료실 좌표가 확보되기 전까지 쓰는 임시 값이다.
// API 계약에 좌표 해석이 없어 Frontend가 다음과 같이 가정한다: 단위는 cm, (mapX, mapY)는 서가의 중심,
// x는 오른쪽·y는 아래, rotationDegree는 시계 방향이고 0이면 폭(widthCm)이 x축, 깊이(depthCm)가 y축이다.
// 자료실마다 따로 쓰는 좌표이며, 여기에 없는 서가(B-04, F-01)는 위치를 등록하지 않은 서가다. 폭은 서가 시드가 정한다.

export type ShelfPosition = Pick<MockShelf, 'mapX' | 'mapY' | 'depthCm' | 'rotationDegree'>

const UNPLACED: ShelfPosition = { mapX: null, mapY: null, depthCm: null, rotationDegree: null }

/** 왼쪽 열의 정사각 서가 */
const square = (mapX: number, mapY: number): ShelfPosition => ({ mapX, mapY, depthCm: 90, rotationDegree: 0 })
/** 오른쪽 열의 가로형 서가. 90도 돌리면 세로형이 된다. */
const bar = (mapX: number, mapY: number, rotationDegree = 0): ShelfPosition => ({ mapX, mapY, depthCm: 30, rotationDegree })

const POSITIONS: Record<string, ShelfPosition> = {
  'A-01': square(60, 60),
  'A-02': square(60, 200),
  'A-03': bar(200, 40),
  'A-04': bar(200, 180),
  'B-01': square(60, 60),
  'B-02': square(60, 200),
  'B-03': bar(200, 60, 90),
  'C-01': square(60, 60),
  'C-02': square(60, 200),
  'C-03': bar(200, 40),
  'C-04': bar(200, 180),
  'D-01': square(60, 60),
  'D-02': bar(200, 40),
  'E-01': square(60, 60),
  'E-02': bar(200, 40),
  'Z-01': bar(60, 40),
  'Z-02': bar(200, 40),
}

export function shelfPositionOf(shelfCode: string): ShelfPosition {
  return { ...(POSITIONS[shelfCode] ?? UNPLACED) }
}
