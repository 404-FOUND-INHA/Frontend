import { ChevronRightIcon } from '@/components/common/icons'
import type { ShelfMapEntry } from './shelfMapModel'
import { shelfSummary, type ShelfMapStatus } from './shelfMapText'

/** 선택한 서가의 요약. 서가 상세 화면은 아직 없어 상세보기는 누를 수 없다. */
export default function ShelfSummaryCard({ entry, status }: { entry: ShelfMapEntry; status: ShelfMapStatus }) {
  const items = shelfSummary(entry, status)
  // 색 표시가 있는 항목과 없는 항목이 섞여도 글의 시작 위치를 맞춘다.
  const marked = items.some((item) => item.marker)

  return (
    <section className="shelf-card" aria-label="선택한 서가 요약" aria-live="polite">
      <div className="shelf-card-body">
        <h2 className="shelf-card-title">{entry.shelfCode} 서가</h2>
        <ul className="shelf-card-items">
          {items.map((item) => (
            <li key={item.text}>
              {marked && (
                <span className={item.marker ? `shelf-swatch shelf-swatch--${item.marker}` : 'shelf-swatch'} aria-hidden="true" />
              )}
              {item.text}
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="shelf-card-detail" disabled aria-label="상세보기 (준비 중)">
        <span>
          상세보기
          <small>준비 중</small>
        </span>
        <ChevronRightIcon size={16} />
      </button>
    </section>
  )
}
