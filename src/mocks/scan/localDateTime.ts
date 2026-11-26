import { isValidIsoDate } from '@/utils/calendarDate'

/** 타임존 없는 ISO 날짜시간(Backend LocalDateTime). 소수 초는 DB 정밀도인 마이크로초(6자리)까지다. */
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d{1,6}))?$/

/**
 * 시각 비교용 값. 형식이 다르거나 존재하지 않는 날짜·시각이면 null이다.
 * 소수 초를 6자리로 맞추므로 같은 시각은 표기가 달라도 같은 문자열이 되고, 문자열 순서가 시간 순서가 된다.
 * Date로 바꾸면 마이크로초가 사라지므로 문자열로 비교한다.
 */
export function timeKey(value: string): string | null {
  const match = DATE_TIME.exec(value)
  if (!match || !isValidIsoDate(match[1])) return null
  return `${value.slice(0, 19)}.${(match[2] ?? '').padEnd(6, '0')}`
}
