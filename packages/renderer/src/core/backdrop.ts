/**
 * Backdrop: the selected region grown by a fixed radius and filled with the pattern background
 * color under the texture. Whole-module drawing leaves a module staircase along the region edge;
 * the backdrop replaces that staircase (and the partially covered modules behind it) with one
 * smooth, antialiased outline. Pixels inside the backdrop are deliberately repainted, so the
 * bit-exact outside/partial-module checks exempt them; everything beyond it stays bit-exact.
 */

const INF = 1e20

/**
 * Antialiased coverage (0-255 per poster pixel) of the region dilated by `radius` pixels.
 * Region pixels are fully covered; outside pixels fade over one pixel at Euclidean distance
 * `radius` from the nearest region pixel. Returns null when `radius` is not positive.
 */
export function computeBackdropCoverage(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array | null {
  if (!(radius > 0)) return null
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const coverage = new Uint8Array(width * height)
  if (maxX < 0) return coverage

  // Only the region bounds grown by the radius can be covered; the transform runs on that window.
  const reach = Math.ceil(radius) + 1
  const left = Math.max(0, minX - reach)
  const top = Math.max(0, minY - reach)
  const right = Math.min(width - 1, maxX + reach)
  const bottom = Math.min(height - 1, maxY + reach)
  const w = right - left + 1
  const h = bottom - top + 1
  const distance = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) distance[y * w + x] = mask[(y + top) * width + x + left] ? 0 : INF
  }

  // Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher), columns then rows.
  const size = Math.max(w, h)
  const f = new Float64Array(size)
  const d = new Float64Array(size)
  const v = new Int32Array(size)
  const z = new Float64Array(size + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = distance[y * w + x]!
    transform1d(f, h, d, v, z)
    for (let y = 0; y < h; y++) distance[y * w + x] = d[y]!
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) f[x] = distance[row + x]!
    transform1d(f, w, d, v, z)
    for (let x = 0; x < w; x++) distance[row + x] = d[x]!
  }

  const outer = (radius + 1) * (radius + 1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const squared = distance[y * w + x]!
      if (squared >= outer) continue
      const alpha = Math.min(1, radius + 1 - Math.sqrt(squared))
      coverage[(y + top) * width + x + left] = Math.round(alpha * 255)
    }
  }
  return coverage
}

function transform1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    const offset = q - v[k]!
    d[q] = offset * offset + f[v[k]!]!
  }
}

/**
 * Paints the backdrop color into `pixels` at each covered pixel. Opaque posters blend the color
 * channels and keep their alpha; the transparent blank canvas composites the backdrop over.
 */
export function paintBackdrop(
  pixels: Uint8Array,
  coverage: Uint8Array,
  color: [number, number, number],
  transparentBlank: boolean,
): void {
  for (let index = 0; index < coverage.length; index++) {
    const alpha = coverage[index]!
    if (alpha === 0) continue
    const offset = index * 4
    const a = alpha / 255
    if (transparentBlank) {
      const destinationAlpha = pixels[offset + 3]! / 255
      const outputAlpha = a + destinationAlpha * (1 - a)
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(
          (color[channel]! * a + pixels[offset + channel]! * destinationAlpha * (1 - a)) / outputAlpha,
        )
      }
      pixels[offset + 3] = Math.round(outputAlpha * 255)
      continue
    }
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] =
        alpha === 255 ? color[channel]! : Math.round(color[channel]! * a + pixels[offset + channel]! * (1 - a))
    }
  }
}
