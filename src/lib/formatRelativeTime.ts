/** Relative time labels in zh-CN (desktop library). */
export function formatRelativeTimeZh(timestampMs: number): string {
  const diff = Date.now() - timestampMs
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return '刚刚'

  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`

  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`

  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`

  const month = Math.floor(day / 30)
  if (month < 12) return `${month} 个月前`

  const year = Math.floor(day / 365)
  return `${year} 年前`
}
