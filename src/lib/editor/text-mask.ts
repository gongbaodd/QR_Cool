// Text-mask fonts bundled under public/fonts. The mask convention is
// white-selects-region on black, so a word rendered in one of these display
// fonts becomes the region the QR texture fills.
export interface TextMaskFont {
  id: string
  /** CSS font-family name, declared with @font-face in globals.css. */
  family: string
  label: string
  /** Public URL of the font file, relative to the site root. */
  file: string
}

export const TEXT_MASK_FONTS: TextMaskFont[] = [
  { id: 'fathead', family: 'Fathead', label: 'Fathead', file: '/fonts/Fathead_PersonalUseOnly.ttf' },
]

export const TEXT_MASK_FILENAME = 'text-mask.png'
export const TEXT_MASK_DEFAULT_TEXT = 'QR'

/**
 * Default cap height: fill the poster height, shrunk to fit the width by
 * {@link fitTextMaskSize}. Small words fail the layout check (the QR needs a
 * whole `totalModules x 4px` square inside the letters), so the default is the
 * largest possible region, not a fixed fraction.
 */
export function defaultTextMaskSize(width: number, height: number): number {
  return Math.max(16, height)
}

/** Largest white inscribed square in RGBA pixels, mirroring the server's
 * white-selects-region rule (opaque, luma >= 128). Lets the editor warn before
 * uploading a word too small to hold the QR. */
export function largestWhiteSquare(pixels: Uint8ClampedArray, width: number, height: number): number {
  let previous = new Uint32Array(width + 1)
  let maximum = 0
  for (let y = 0; y < height; y++) {
    const current = new Uint32Array(width + 1)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const selected = pixels[offset + 3]! >= 128
        && (299 * pixels[offset]! + 587 * pixels[offset + 1]! + 114 * pixels[offset + 2]!) / 1000 >= 128
      if (!selected) continue
      current[x + 1] = 1 + Math.min(previous[x + 1]!, current[x]!, previous[x]!)
      if (current[x + 1]! > maximum) maximum = current[x + 1]!
    }
    previous = current
  }
  return maximum
}

/** Largest size that fits one line of text inside the canvas at the given cap. */
export function fitTextMaskSize(
  measure: (sizePx: number) => number,
  maxWidth: number,
  sizePx: number,
  minPx = 8,
): number {
  const measured = measure(sizePx)
  if (!(measured > 0) || measured <= maxWidth) return sizePx
  return Math.max(minPx, Math.floor((sizePx * maxWidth) / measured))
}
