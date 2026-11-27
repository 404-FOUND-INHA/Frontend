/** 키가 같은 항목은 처음 것만 남긴다. 순서는 유지한다. */
export function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => number): T[] {
  const seen = new Set<number>()
  return items.filter((item) => {
    const key = keyOf(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
