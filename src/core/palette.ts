/**
 * The pattern palette: pixel (ink), marker (finder/alignment ink), and background
 * (light) colors, plus the OKLCH machinery that derives suggestions from the pixel
 * color and guards decoding contrast. Pure and dependency-free: UI, worker, and
 * Node tests share the exact same numbers.
 */

export interface QrPalette {
  /** Ink of every dark module: texture cells, data modules, the rim, marker-refill bits. */
  pixel: string
  /** Ink of the three finder markers and the circular alignment marker. */
  marker: string
  /** Light modules: quiet zone, marker rings, the plate's light band, the region margin. */
  background: string
}

export const DEFAULT_PALETTE: QrPalette = { pixel: '#000000', marker: '#000000', background: '#ffffff' }

export interface Oklch {
  /** Perceptual lightness [0, 1]. */
  l: number
  /** Chroma, roughly [0, 0.37] inside sRGB. */
  c: number
  /** Hue in degrees [0, 360). */
  h: number
}

/** Guard limits. Luma thresholds mirror qr.ts: the quiet-zone rule needs 200 and ink detection is 128. */
export const GUARD = {
  /** Rec.601 luma a selectable background must stay above (quiet-zone rule needs 200; kept headroom). */
  lightLumaMin: 205,
  /** Rec.601 luma every ink must stay at or below (INK_LUMA_THRESHOLD is 128; kept headroom). */
  inkLumaMax: 120,
  /** OKLCH lightness distance each ink must keep from the background. */
  minLightnessDistance: 0.3,
} as const

export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/

export type Rgb = [number, number, number]

/** Parses `#rgb`/`#rrggbb` (any case); null for anything else. */
export function parseHex(hex: string): Rgb | null {
  const value = hex.trim()
  if (!HEX_PATTERN.test(value) && !/^#[0-9a-fA-F]{3}$/.test(value)) return null
  const body = value.slice(1)
  const digits = body.length === 3 ? [...body].map((c) => c + c).join('') : body
  const channels = [0, 2, 4].map((start) => Number.parseInt(digits.slice(start, start + 2), 16))
  if (channels.some((channel) => Number.isNaN(channel))) return null
  return [channels[0]!, channels[1]!, channels[2]!]
}

/** Lowercase six-digit form; null when the input is not a parseable hex color. */
export function normalizeHex(hex: string): string | null {
  const rgb = parseHex(hex)
  return rgb ? hexFromRgb(rgb) : null
}

function hexFromRgb([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** Rec.601 luma — the same grayscale weights the QR pipeline's ink and quiet-zone rules use. */
export function luma([r, g, b]: Rgb): number {
  return Math.round((299 * r + 587 * g + 114 * b) / 1000)
}

/** Convenience for renderers turning a stored hex into 0-255 channels. */
export function hexToRgb(hex: string): Rgb {
  return parseHex(hex) ?? [0, 0, 0]
}

/** Björn Ottosson's OKLab matrices (linear sRGB ↔ OKLab). */
const LINEAR_SRGB_TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
] as const
const LMS_CUBIC_TO_OKLAB = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
] as const
const OKLAB_TO_LMS_CUBIC_ROOTS = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
] as const
const LMS_CUBED_TO_LINEAR_SRGB = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const

function mix(row: readonly [number, number, number], values: readonly number[]): number {
  return row[0] * values[0]! + row[1] * values[1]! + row[2] * values[2]!
}

function decodeSrgb(channel: number): number {
  const u = channel / 255
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4
}

function encodeSrgb(linear: number): number {
  const u = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
  return Math.round(u * 255)
}

export function rgbToOklch(rgb: Rgb): Oklch {
  const linear = [rgb[0], rgb[1], rgb[2]].map(decodeSrgb)
  const lmsCubeRoots = LINEAR_SRGB_TO_LMS.map((row) =>
    Math.cbrt(Math.max(0, mix(row as [number, number, number], linear))),
  )
  const [L, a, b] = LMS_CUBIC_TO_OKLAB.map((row) => mix(row as [number, number, number], lmsCubeRoots))
  const c = Math.sqrt(a! * a! + b! * b!)
  const h = ((Math.atan2(b!, a!) * 180) / Math.PI + 360) % 360
  return { l: L!, c, h }
}

/** OKLCH → 8-bit sRGB when in gamut, null otherwise. */
function oklchToRgb({ l, c, h }: Oklch): Rgb | null {
  const rad = (h * Math.PI) / 180
  const a = Math.cos(rad) * c
  const b = Math.sin(rad) * c
  const cubeRoots = OKLAB_TO_LMS_CUBIC_ROOTS.map((row) => mix(row as [number, number, number], [l, a, b]))
  const lin = cubeRoots.map((root) => root ** 3)
  const channels = LMS_CUBED_TO_LINEAR_SRGB.map((row) => encodeSrgb(mix(row as [number, number, number], lin)))
  return channels.some((channel) => channel < 0 || channel > 255) ? null : (channels as Rgb)
}

/**
 * OKLCH → sRGB, always in gamut: chroma is reduced in fixed `CHROMA_STEP` decrements
 * until every channel lands in [0, 255], so the same OKLCH maps to the same hex.
 */
export function oklchToHex({ l, c, h }: Oklch, step = 0.005): string {
  for (let chroma = Math.max(0, c); ; chroma = Math.max(0, chroma - step)) {
    const rgb = oklchToRgb({ l, c: chroma, h })
    if (rgb) return hexFromRgb(rgb)
  }
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex)
  return rgb ? rgbToOklch(rgb) : null
}

/**
 * Suggests marker and background colors for a picked pixel color, derived in OKLCH:
 * the background is a faint tint of the same hue near white, the marker is a tonal
 * step of the pixel's own tone (same hue and chroma, stepped down the lightness axis)
 * that stays decode-dark. Both always pass the palette guard.
 */
export function suggestPalette(pixel: string): { marker: string; background: string } {
  const rgb = parseHex(pixel)
  if (!rgb) return { marker: DEFAULT_PALETTE.marker, background: DEFAULT_PALETTE.background }
  const { l, c, h } = rgbToOklch(rgb)

  // Background: same hue, near-white, faintly tinted. Achromatic pixels stay pure white.
  const background = c < 0.01 ? DEFAULT_PALETTE.background : tintedLight({ l: 0.97, c: Math.min(c, 0.04), h })

  // Marker: a lightness step of the pixel's own tone — darker than the pixel, ink-dark.
  let markerLightness = Math.min(l * 0.85, l)
  let marker = oklchToHex({ l: markerLightness, c, h })
  while (luma(hexToRgb(marker)) > GUARD.inkLumaMax && markerLightness > 0) {
    markerLightness = Math.max(0, markerLightness - 0.05)
    marker = oklchToHex({ l: markerLightness, c, h })
  }
  return { marker, background }
}

/** Halves the tint until the suggestion satisfies the background luma guard (chroma 0 always passes). */
function tintedLight(candidate: Oklch): string {
  let chroma = candidate.c
  for (;;) {
    const hex = oklchToHex({ l: candidate.l, c: chroma, h: candidate.h })
    if (luma(hexToRgb(hex)) >= GUARD.lightLumaMin) return hex
    if (chroma <= 0) return DEFAULT_PALETTE.background
    chroma = chroma / 2
  }
}

export interface PaletteIssue {
  color: keyof QrPalette
  message: string
}

/**
 * Decoding-safety guard for a user-edited palette: the background must stay light
 * (the engine's quiet-zone rule counts brightness ≥ 200 as light), every ink must
 * stay dark, and each ink must separate from the background in OKLCH lightness.
 * The generated QR's decode round-trip remains the authoritative gate; this reports
 * early, before a prepare request is spent.
 */
export function paletteGuard(palette: QrPalette): { ok: boolean; issues: PaletteIssue[] } {
  const issues: PaletteIssue[] = []
  const keys = ['pixel', 'marker', 'background'] as const
  const colors = new Map<keyof QrPalette, Rgb | null>()
  for (const key of keys) {
    const rgb = normalizeHex(palette[key]) ? parseHex(palette[key]) : null
    colors.set(key, rgb)
    if (!rgb) issues.push({ color: key, message: 'Use a 6-digit hex color like #0b3d91.' })
  }
  if (issues.length > 0) return { ok: false, issues }

  const background = colors.get('background')!
  if (luma(background) < GUARD.lightLumaMin)
    issues.push({ color: 'background', message: 'The background is too dark to keep the QR light modules readable.' })
  const backgroundLightness = rgbToOklch(background).l
  for (const key of ['pixel', 'marker'] as const) {
    const rgb = colors.get(key)!
    if (luma(rgb) > GUARD.inkLumaMax)
      issues.push({ color: key, message: 'This ink is too light to read as a dark module; pick a darker color.' })
    if (Math.abs(rgbToOklch(rgb).l - backgroundLightness) < GUARD.minLightnessDistance)
      issues.push({
        color: key,
        message: 'Not enough lightness separation from the background for reliable scanning.',
      })
  }
  return { ok: issues.length === 0, issues }
}
