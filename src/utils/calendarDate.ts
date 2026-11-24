const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/**
 * 'YYYY-MM-DD' 형식이면서 실제 달력에 존재하는 날짜인지 검사한다.
 * JavaScript Date는 '2026-02-30' 같은 값을 보정하거나 환경별로 다르게 해석하므로 사용하지 않고 직접 계산한다.
 * (Backend LocalDate 파싱이 존재하지 않는 날짜를 거부하는 것과 같은 결과)
 */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= daysInMonth(year, month)
}
