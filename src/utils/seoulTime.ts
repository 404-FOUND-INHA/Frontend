// "오늘" 판단 등 서비스 기준 시각은 브라우저 시간대가 아니라 서울(Asia/Seoul)이다. (Backend ClockConfig.SERVICE_ZONE)

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23', // 자정을 '24'가 아닌 '00'으로 표기
})

function seoulParts(epochMs: number): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    parts[part.type] = part.value
  }
  return parts
}

/** 서울 기준 날짜 'YYYY-MM-DD' */
export function seoulDate(epochMs: number): string {
  const p = seoulParts(epochMs)
  return `${p.year}-${p.month}-${p.day}`
}

/** 서울 기준 시각 'YYYY-MM-DDTHH:mm:ss' (타임존 표기 없음, Backend LocalDateTime 형태) */
export function seoulDateTime(epochMs: number): string {
  const p = seoulParts(epochMs)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

/**
 * 밀리초까지 담은 서울 기준 시각. 밀리초가 0이면 seoulDateTime처럼 소수 초를 쓰지 않는다.
 * UTC 오프셋에는 밀리초가 없으므로 밀리초 값은 UTC와 같다.
 */
export function seoulDateTimeWithMillis(epochMs: number): string {
  const millis = new Date(epochMs).getUTCMilliseconds()
  const dateTime = seoulDateTime(epochMs)
  return millis === 0 ? dateTime : `${dateTime}.${String(millis).padStart(3, '0')}`
}
