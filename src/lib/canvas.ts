/** Canvas coordinate / layout helpers */

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1)
}
