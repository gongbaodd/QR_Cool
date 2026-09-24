import { z } from 'zod'
import { DEFAULT_PALETTE, HEX_PATTERN } from '@/core/palette'
import { canonicalizeRotation, localPointInPlate, posterToPlatePoint, rotatedFootprintBounds } from '@/core/rotate'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_PIXELS = 4_000_000
export const MAX_BODY_BYTES = 2 * MAX_IMAGE_BYTES + 64 * 1024
export const contentSchema = z
  .string()
  .max(8000, 'Text exceeds QR capacity.')
  .refine((s) => s.trim().length > 0, 'Enter text or a URL.')
  .refine((s) => !/[\r\n]/.test(s), 'Use one line only.')
export const rotationSchema = z.number().finite().default(0)
export const placementSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    size: z.number().int().positive(),
    rotation: rotationSchema,
  })
  .strict()
export const settingsSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff),
    qrMargin: z.literal(1).default(1),
    plateCorners: z.enum(['texture', 'light']).default('texture'),
    regionMargin: z.boolean().default(false),
    rimModules: z.number().int().min(0).max(5).default(1),
    rimRounded: z.boolean().default(false),
    ecc: z.enum(['L', 'M', 'Q', 'H']).default('M'),
    pixelStyle: z.enum(['square', 'rounded', 'dot']).default('dot'),
    finderMarkers: z
      .object({
        tl: z
          .object({
            style: z.enum(['square', 'rounded']).default('rounded'),
            shape: z.enum(['square', 'circle', 'octagon', 'squircle']).default('circle'),
            inner: z.enum(['square', 'circle', 'plus', 'diamond', 'squircle']).default('circle'),
          })
          .default({ style: 'rounded', shape: 'circle', inner: 'circle' }),
        tr: z
          .object({
            style: z.enum(['square', 'rounded']).default('rounded'),
            shape: z.enum(['square', 'circle', 'octagon', 'squircle']).default('circle'),
            inner: z.enum(['square', 'circle', 'plus', 'diamond', 'squircle']).default('circle'),
          })
          .default({ style: 'rounded', shape: 'circle', inner: 'circle' }),
        bl: z
          .object({
            style: z.enum(['square', 'rounded']).default('rounded'),
            shape: z.enum(['square', 'circle', 'octagon', 'squircle']).default('circle'),
            inner: z.enum(['square', 'circle', 'plus', 'diamond', 'squircle']).default('circle'),
          })
          .default({ style: 'rounded', shape: 'circle', inner: 'circle' }),
      })
      .default({
        tl: { style: 'rounded', shape: 'circle', inner: 'circle' },
        tr: { style: 'rounded', shape: 'circle', inner: 'circle' },
        bl: { style: 'rounded', shape: 'circle', inner: 'circle' },
      }),
    markerSub: z.enum(['square', 'circle']).default('square'),
    colors: z
      .object({
        pixel: z.string().regex(HEX_PATTERN),
        marker: z.string().regex(HEX_PATTERN),
        background: z.string().regex(HEX_PATTERN),
      })
      .default(DEFAULT_PALETTE),
  })
  .strict()
export const requestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    content: contentSchema,
    placement: placementSchema.optional(),
    previousTotalModules: z.number().int().min(25).max(181).optional(),
    settings: settingsSchema,
  })
  .strict()
export type Placement = z.infer<typeof placementSchema>
export type Settings = z.infer<typeof settingsSchema>
export type EditorRequest = z.infer<typeof requestSchema>

/** A placement under construction may omit rotation (canonicalized to 0). */
export type PlacementInput = z.input<typeof placementSchema>

export function canonicalPlacement(box: PlacementInput, totalModules: number): Placement {
  // Signed origins keep off-canvas placement editable; export performs strict bounds checks.
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    size: Math.max(4, Math.round(box.size / totalModules)) * totalModules,
    rotation: canonicalizeRotation(box.rotation),
  }
}
export function fitsMask(mask: Uint8Array, width: number, height: number, box: PlacementInput): boolean {
  if (
    ![box.x, box.y, box.size].every(Number.isInteger) ||
    box.size <= 0 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.size > width ||
    box.y + box.size > height
  )
    return false
  const size = box.size
  const rotation = canonicalizeRotation(box.rotation)
  if (rotation === 0) {
    for (let y = box.y; y < box.y + size; y++)
      for (let x = box.x; x < box.x + size; x++) if (!mask[y * width + x]) return false
    return true
  }
  // Rotated square: containment is tested against the actual rotated footprint —
  // the axis-aligned bounding box is necessary but not sufficient for irregular masks.
  const footprint = rotatedFootprintBounds({ x: box.x, y: box.y, size, rotation }, width, height)
  const placementBox = { x: box.x, y: box.y, size, rotation }
  for (let y = footprint.top; y < footprint.bottom; y++) {
    for (let x = footprint.left; x < footprint.right; x++) {
      const local = posterToPlatePoint(x + 0.5, y + 0.5, placementBox)
      if (!localPointInPlate(local.x, local.y, size)) continue
      if (!mask[y * width + x]) return false
    }
  }
  return true
}
