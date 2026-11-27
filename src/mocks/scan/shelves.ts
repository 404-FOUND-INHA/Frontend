import type { ShelfListParams, ShelfResponse } from '@/types/scan/shelf'
import { compareShelves } from './analysis'
import type { MockData, MockShelf } from './types'

// 서가 조회 응답을 Mock 데이터에서 만든다(Backend ShelfService.list). 도서 수는 저장하지 않고 도서의 현재 서가에서 센다.
// Mock 서가에 없는 값(서가·단 번호, 청구기호 범위, 마커, 높이, mapZ)은 null이고, 생성·수정 시각은 고정값이다.

const SHELF_RECORDED_AT = '2023-01-02T09:00:00'

function toResponse(shelf: MockShelf, bookCount: number): ShelfResponse {
  return {
    id: shelf.id,
    shelfCode: shelf.shelfCode,
    zone: shelf.zone,
    floorNo: shelf.floorNo,
    shelfNo: null,
    levelNo: null,
    callNumberStart: null,
    callNumberEnd: null,
    markerId: null,
    mapX: shelf.mapX,
    mapY: shelf.mapY,
    mapZ: null,
    widthCm: shelf.widthCm,
    heightCm: null,
    depthCm: shelf.depthCm,
    rotationDegree: shelf.rotationDegree,
    displayOrder: shelf.displayOrder,
    active: shelf.active,
    bookCount,
    createdAt: SHELF_RECORDED_AT,
    updatedAt: SHELF_RECORDED_AT,
  }
}

export function buildShelves(data: MockData, { zone, includeInactive = false }: ShelfListParams): ShelfResponse[] {
  const wanted = zone?.trim()
  const counts = new Map<number, number>()
  for (const { currentShelfId } of data.books) {
    if (currentShelfId !== null) counts.set(currentShelfId, (counts.get(currentShelfId) ?? 0) + 1)
  }
  return data.shelves
    .filter((shelf) => (!wanted || shelf.zone === wanted) && (includeInactive || shelf.active))
    .sort(compareShelves)
    .map((shelf) => toResponse(shelf, counts.get(shelf.id) ?? 0))
}
