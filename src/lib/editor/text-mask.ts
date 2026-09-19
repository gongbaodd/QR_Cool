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
  /** Optional usage caveat shown under the mask font picker. */
  note?: string
}

export const TEXT_MASK_FONTS: TextMaskFont[] = [
  { id: 'fathead', family: 'Fathead', label: 'Fathead', file: '/fonts/Fathead_PersonalUseOnly.ttf' },
  { id: 'fatc', family: 'FatC', label: 'FatC', file: '/fonts/FatC.ttf' },
  { id: 'fat-ass-filled', family: 'Fat Ass Filled', label: 'Fat Ass Filled', file: '/fonts/FATASSFI.TTF' },
  { id: 'fat-bross', family: 'Fat Bross', label: 'Fat Bross', file: '/fonts/FAT BROSS.ttf' },
  { id: 'fat-cat', family: 'Fat Cat', label: 'Fat Cat', file: '/fonts/FatCatDEMO.otf' },
  { id: 'fat-fantasy', family: 'Fat Fantasy', label: 'Fat Fantasy', file: '/fonts/Fat Fantasy.ttf' },
  { id: 'fats-are-good', family: 'Fats Are Good', label: 'Fats Are Good', file: '/fonts/FATS ARE GOOD.otf' },
  { id: 'fatlove', family: 'Fatlove', label: 'Happyloverstown Fatlove', file: '/fonts/avantfatlove.ttf' },
  { id: 'slukoni-fat', family: 'Slukoni Fat', label: 'Slukoni Fat', file: '/fonts/Slukoni-Fat.otf' },
  { id: 'trinta-quatro-fat', family: 'Trinta Quatro Fat', label: 'Trinta Quatro Fat', file: '/fonts/Trinta_quatro Fat.ttf', note: 'Uppercase, digits and punctuation only.' },
  { id: 'wear-fat-shirt', family: 'Wear Fat Shirt', label: 'Wear Fat Shirt', file: '/fonts/WEAR FAT SHIRT.ttf' },
  { id: 'blank', family: '', label: 'blank', file: '' },
]

export const TEXT_MASK_FILENAME = 'text-mask.png'
export const TEXT_MASK_DEFAULT_TEXT = 'Q'
export const TEXT_MASK_MAX_LENGTH = 1

/**
 * Derive the single-letter mask suggestion from encoded content.
 * Website-like input yields the first letter of the host (scheme and a
 * leading `www.` are ignored, uppercased): `http://ABCD.com` -> `A`,
 * `www.XYZ.com` -> `X`. Anything else returns '' so the caller falls back
 * to a blank full-canvas region.
 */
export function deriveMaskLetter(content: string): string {
  const trimmed = content.trim()
  if (!trimmed || /\s/.test(trimmed)) return ''
  const withoutScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
  const withoutWww = withoutScheme.replace(/^www\./i, '')
  const host = withoutWww.split(/[\/?#:]/, 1)[0] ?? ''
  if (!host.includes('.')) return ''
  const match = host.match(/[A-Za-z]/)
  return match ? match[0]!.toUpperCase() : ''
}

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
