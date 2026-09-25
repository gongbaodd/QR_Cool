// Blank-canvas starter poster. A transparent sheet has no black shape for the
// automatic detector, so it is paired with a full-white mask (white selects
// the region) that makes the whole canvas available for the generated design.
// The pixel layouts are shared by the browser (drawn via canvas ImageData)
// and tested in Node (encoded with sharp, then run through the mask builders).
export const BLANK_POSTER_WIDTH = 1000
export const BLANK_POSTER_HEIGHT = 1000
export const BLANK_POSTER_FILENAME = 'blank-poster.png'
export const BLANK_MASK_FILENAME = 'blank-mask.png'

export function buildBlankPosterRgba(
  width: number = BLANK_POSTER_WIDTH,
  height: number = BLANK_POSTER_HEIGHT,
): Uint8Array {
  // Transparent black; the separate full-white mask continues to select the canvas.
  return new Uint8Array(width * height * 4)
}

export function buildBlankMaskRgba(
  width: number = BLANK_POSTER_WIDTH,
  height: number = BLANK_POSTER_HEIGHT,
): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  data.fill(255)
  return data
}
