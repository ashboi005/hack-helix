import { clamp, odd } from "./math"
import type { Component, Point } from "./types"

export function toGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    out[j] = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114)
  }
  return out
}

export function equalize(gray: Uint8Array): Uint8Array {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1

  const cdf = new Uint32Array(256)
  let running = 0
  for (let i = 0; i < 256; i += 1) {
    running += hist[i]
    cdf[i] = running
  }

  let cdfMin = 0
  for (let i = 0; i < 256; i += 1) {
    if (hist[i] > 0) {
      cdfMin = cdf[i]
      break
    }
  }
  if (gray.length <= cdfMin) return gray.slice()

  const out = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = clamp(Math.round(((cdf[gray[i]] - cdfMin) / (gray.length - cdfMin)) * 255), 0, 255)
  }
  return out
}

export function gaussian(gray: Uint8Array, width: number, height: number, size: number): Uint8Array {
  if (size <= 1) return gray.slice()
  const s = odd(size, 1)
  const radius = Math.floor(s / 2)
  const sigma = Math.max(0.8, s / 3)

  const kernel = new Float32Array(s)
  let sum = 0
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = v
    sum += v
  }
  for (let i = 0; i < s; i += 1) kernel[i] /= sum

  const horiz = new Float32Array(gray.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 0
      for (let k = -radius; k <= radius; k += 1) {
        v += gray[y * width + clamp(x + k, 0, width - 1)] * kernel[k + radius]
      }
      horiz[y * width + x] = v
    }
  }

  const out = new Uint8Array(gray.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 0
      for (let k = -radius; k <= radius; k += 1) {
        v += horiz[clamp(y + k, 0, height - 1) * width + x] * kernel[k + radius]
      }
      out[y * width + x] = clamp(Math.round(v), 0, 255)
    }
  }

  return out
}

export function adaptiveInv(
  gray: Uint8Array,
  width: number,
  height: number,
  blockSize: number,
  c: number,
): Uint8Array {
  const half = Math.floor(odd(blockSize, 3) / 2)
  const integral = new Uint32Array((width + 1) * (height + 1))

  for (let y = 1; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      integral[y * (width + 1) + x] =
        gray[(y - 1) * width + (x - 1)]
        + integral[(y - 1) * (width + 1) + x]
        + integral[y * (width + 1) + (x - 1)]
        - integral[(y - 1) * (width + 1) + (x - 1)]
    }
  }

  const out = new Uint8Array(gray.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x0 = clamp(x - half, 0, width - 1)
      const x1 = clamp(x + half, 0, width - 1)
      const y0 = clamp(y - half, 0, height - 1)
      const y1 = clamp(y + half, 0, height - 1)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum =
        integral[(y1 + 1) * (width + 1) + (x1 + 1)]
        - integral[y0 * (width + 1) + (x1 + 1)]
        - integral[(y1 + 1) * (width + 1) + x0]
        + integral[y0 * (width + 1) + x0]
      out[y * width + x] = gray[y * width + x] > sum / area - c ? 0 : 255
    }
  }

  return out
}

export function and(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] && b[i] ? 255 : 0
  return out
}

export function count(values: Uint8Array): number {
  let n = 0
  for (let i = 0; i < values.length; i += 1) if (values[i]) n += 1
  return n
}

export function percentile(values: Uint8Array, q: number): number {
  const hist = new Uint32Array(256)
  for (let i = 0; i < values.length; i += 1) hist[values[i]] += 1
  const target = Math.floor(clamp(q, 0, 1) * values.length)
  let running = 0
  for (let i = 0; i < 256; i += 1) {
    running += hist[i]
    if (running >= target) return i
  }
  return 255
}

export function morph(mask: Uint8Array, width: number, height: number): Uint8Array {
  const neighbors: Point[] = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [0, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ]

  const dil = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = false
      for (const [dx, dy] of neighbors) {
        const px = x + dx
        const py = y + dy
        if (px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px] > 0) {
          on = true
          break
        }
      }
      dil[y * width + x] = on ? 255 : 0
    }
  }

  const ero = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = true
      for (const [dx, dy] of neighbors) {
        const px = x + dx
        const py = y + dy
        if (px < 0 || py < 0 || px >= width || py >= height || dil[py * width + px] === 0) {
          on = false
          break
        }
      }
      ero[y * width + x] = on ? 255 : 0
    }
  }

  return ero
}

export function components(mask: Uint8Array, width: number, height: number): Component[] {
  const visited = new Uint8Array(mask.length)
  const n8: Point[] = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ]
  const n4: Point[] = [[0, -1], [1, 0], [0, 1], [-1, 0]]

  const out: Component[] = []

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x
      if (!mask[start] || visited[start]) continue

      const qx: number[] = [x]
      const qy: number[] = [y]
      visited[start] = 1
      let head = 0

      let area = 0
      let perimeter = 0
      let minX = x
      let minY = y
      let maxX = x
      let maxY = y
      let sumX = 0
      let sumY = 0
      const points: number[] = []

      while (head < qx.length) {
        const cx = qx[head]
        const cy = qy[head]
        head += 1

        area += 1
        sumX += cx
        sumY += cy
        points.push(cx, cy)

        if (cx < minX) minX = cx
        if (cy < minY) minY = cy
        if (cx > maxX) maxX = cx
        if (cy > maxY) maxY = cy

        for (const [dx, dy] of n4) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || mask[ny * width + nx] === 0) {
            perimeter += 1
          }
        }

        for (const [dx, dy] of n8) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const idx = ny * width + nx
          if (!mask[idx] || visited[idx]) continue
          visited[idx] = 1
          qx.push(nx)
          qy.push(ny)
        }
      }

      out.push({
        area,
        perimeter,
        bbox: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        points,
        sumX,
        sumY,
      })
    }
  }

  return out
}

export function componentMean(c: Component, gray: Uint8Array, width: number): number {
  if (c.area <= 0) return 0
  let sum = 0
  for (let i = 0; i < c.points.length; i += 2) sum += gray[c.points[i + 1] * width + c.points[i]]
  return sum / c.area
}
