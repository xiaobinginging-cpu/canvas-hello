/** Programmatic download using an object URL or same-origin URL. */
export function downloadObjectUrl(href: string, downloadFileName: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = downloadFileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
