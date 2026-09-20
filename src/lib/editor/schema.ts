import { z } from 'zod'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_PIXELS = 4_000_000
export const MAX_BODY_BYTES = 2 * MAX_IMAGE_BYTES + 64 * 1024
export const contentSchema = z
  .string()
  .max(8000, 'Text exceeds QR capacity.')
  .refine((s) => s.trim().length > 0, 'Enter text or a URL.')
  .refine((s) => !/[\r\n]/.test(s), 'Use one line only.')
export const placementSchema = z
  .object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), size: z.number().int().positive() })
  .strict()
export const settingsSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff),
    qrMargin: z.literal(1).default(1),
    plateCorners: z.enum(['texture', 'light']).default('texture'),
    rimModules: z.number().int().min(0).max(5).default(1),
    rimRounded: z.boolean().default(false),
    ecc: z.enum(['L', 'M', 'Q', 'H']).default('M'),
    pixelStyle: z.enum(['square', 'rounded', 'dot']).default('rounded'),
    markerStyle: z.enum(['square', 'rounded']).default('rounded'),
    markerShape: z.enum(['square', 'circle', 'octagon']).default('circle'),
    markerInner: z.enum(['square', 'circle', 'plus', 'diamond']).default('circle'),
    markerSub: z.enum(['square', 'circle']).default('square'),
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

export function canonicalPlacement(box: Placement, totalModules: number): Placement {
  // Dragging is clamped to the poster origin like the arrow-key nudges, so the editor
  // never sends the request schema a negative coordinate it would reject with a 400.
  return {
    x: Math.max(0, Math.round(box.x)),
    y: Math.max(0, Math.round(box.y)),
    size: Math.max(4, Math.round(box.size / totalModules)) * totalModules,
  }
}
export function fitsMask(mask: Uint8Array, width: number, height: number, box: Placement): boolean {
  if (
    ![box.x, box.y, box.size].every(Number.isInteger) ||
    box.size <= 0 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.size > width ||
    box.y + box.size > height
  )
    return false
  for (let y = box.y; y < box.y + box.size; y++)
    for (let x = box.x; x < box.x + box.size; x++) if (!mask[y * width + x]) return false
  return true
}
