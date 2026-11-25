import { STATUS_FILTERS, type StatusFilterKey } from './scanListView'

interface ScanStatusFilterProps {
  value: StatusFilterKey
  onChange: (key: StatusFilterKey) => void
}

/** 상태 필터 칩. 선택 상태는 부모(URL)가 가진다. */
export default function ScanStatusFilter({ value, onChange }: ScanStatusFilterProps) {
  return (
    <div className="scan-filter" role="group" aria-label="상태 필터">
      {STATUS_FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className={filter.key === value ? 'scan-chip scan-chip--on' : 'scan-chip'}
          aria-pressed={filter.key === value}
          onClick={() => onChange(filter.key)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}
