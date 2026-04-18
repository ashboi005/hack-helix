import type { Point, Vector3 } from "./types"

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function odd(v: number, min: number): number {
  let out = Math.max(min, Math.round(v))
  if (out % 2 === 0) out += 1
  return out
}

export function norm(v: [number, number]): [number, number] {
  const m = Math.hypot(v[0], v[1])
  if (m <= 1e-8) return [0, 0]
  return [v[0] / m, v[1] / m]
}

export function normalize3(v: Vector3): Vector3 | null {
  const m = Math.hypot(v[0], v[1], v[2])
  if (!Number.isFinite(m) || m <= 1e-8) return null
  return [v[0] / m, v[1] / m, v[2] / m]
}

export function smooth(prev: Vector3, next: Vector3, k: number): Vector3 {
  return [
    k * next[0] + (1 - k) * prev[0],
    k * next[1] + (1 - k) * prev[1],
    k * next[2] + (1 - k) * prev[2],
  ]
}

export function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1]
}

export function cross2d(a: Point, b: Point): number {
  return a[0] * b[1] - a[1] * b[0]
}
