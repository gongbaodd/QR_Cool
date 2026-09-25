import { z } from 'zod'
import type { Imaging } from '@/core/imaging/types'
import { assemblePayload } from '@/lib/editor/engine/pipeline'
import type { AssembleInput } from '@/lib/editor/engine'
import { parsePngHeader } from '@/lib/editor/png-guard'
import { MAX_IMAGE_BYTES, MAX_PIXELS, contentSchema, placementSchema, settingsSchema } from '@/lib/editor/schema'
import type { Settings } from '@/lib/editor/schema'
import { engineDefaults } from '@/lib/editor/engine/pipeline'

export const RECIPE_FORMAT = 'mahu-qr-recipe'
export const RECIPE_SCHEMA_VERSION = 1
export const RECIPE_RENDERER_VERSION = 'mahu-qr-renderer-1'
export const MAX_RECIPE_BYTES = 28 * 1024 * 1024

const MAX_BASE64_IMAGE_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const embeddedPngSchema = z
  .object({
    mimeType: z.literal('image/png'),
    encoding: z.literal('base64'),
    sha256: digestSchema,
    data: z.string().min(4).max(MAX_BASE64_IMAGE_CHARS),
  })
  .strict()

export const recipeSchema = z
  .object({
    format: z.literal(RECIPE_FORMAT),
    schemaVersion: z.literal(RECIPE_SCHEMA_VERSION),
    rendererVersion: z.literal(RECIPE_RENDERER_VERSION),
    content: contentSchema,
    source: z
      .object({
        poster: embeddedPngSchema,
        regionMask: embeddedPngSchema,
        width: z.number().int().positive().max(MAX_PIXELS),
        height: z.number().int().positive().max(MAX_PIXELS),
        transparentBlank: z.boolean(),
      })
      .strict()
      .refine(({ width, height }) => width * height <= MAX_PIXELS, 'Image exceeds the pixel limit.'),
    placement: placementSchema,
    settings: settingsSchema,
  })
  .strict()

export type PortableRecipe = z.infer<typeof recipeSchema>

function toBase64(bytes: Uint8Array): string {
  const blockSize = 0x6000
  const encoded: string[] = []
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const end = Math.min(offset + blockSize, bytes.length)
    let chunk = ''
    for (let index = offset; index < end; index++) chunk += String.fromCharCode(bytes[index]!)
    encoded.push(btoa(chunk))
  }
  return encoded.join('')
}

function fromBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('Recipe image data is not valid base64.')
  const binary = atob(value)
  if (binary.length > MAX_IMAGE_BYTES) throw new Error('Recipe PNG must be 10 MiB or smaller.')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalizedSettings(input: AssembleInput): Settings {
  return settingsSchema.parse({
    ...engineDefaults,
    seed: input.seed,
    qrMargin: input.qrMargin,
    plateCorners: input.plateCorners,
    regionMargin: input.regionMargin,
    rimModules: input.rimModules,
    rimRounded: input.rimRounded,
    ecc: input.ecc,
    pixelStyle: input.pixelStyle,
    finderMarkers: input.finderMarkers,
    markerSub: input.markerSub,
    colors: input.colors,
  })
}

export async function createRecipeBlob(input: AssembleInput, finalMask: Blob): Promise<Blob> {
  const [poster, regionMask] = await Promise.all([
    Promise.resolve(new Uint8Array(input.posterBytes)),
    finalMask.arrayBuffer().then((bytes) => new Uint8Array(bytes)),
  ])
  if (poster.length > MAX_IMAGE_BYTES || regionMask.length > MAX_IMAGE_BYTES)
    throw new Error('The source poster and final region mask must each be 10 MiB or smaller to export a recipe.')
  const posterHeader = parsePngHeader(poster, 'poster')
  const maskHeader = parsePngHeader(regionMask, 'mask')
  if (posterHeader.width !== maskHeader.width || posterHeader.height !== maskHeader.height)
    throw new Error('The final region mask must match the poster dimensions.')
  const [posterSha, maskSha] = await Promise.all([sha256Hex(poster), sha256Hex(regionMask)])
  const recipe = recipeSchema.parse({
    format: RECIPE_FORMAT,
    schemaVersion: RECIPE_SCHEMA_VERSION,
    rendererVersion: RECIPE_RENDERER_VERSION,
    content: input.content,
    source: {
      poster: { mimeType: 'image/png', encoding: 'base64', sha256: posterSha, data: toBase64(poster) },
      regionMask: {
        mimeType: 'image/png',
        encoding: 'base64',
        sha256: maskSha,
        data: toBase64(regionMask),
      },
      width: posterHeader.width,
      height: posterHeader.height,
      transparentBlank: input.transparentBlank ?? false,
    },
    placement: input.placement,
    settings: normalizedSettings(input),
  })
  return new Blob([JSON.stringify(recipe)], { type: 'application/json' })
}

export async function renderRecipe(
  imaging: Imaging,
  rawRecipe: unknown,
  artifact: 'poster.png' | 'qr.png',
): Promise<{ png: Blob; filename: string }> {
  const recipe = recipeSchema.parse(rawRecipe)
  const poster = fromBase64(recipe.source.poster.data)
  const regionMask = fromBase64(recipe.source.regionMask.data)
  const [posterSha, maskSha] = await Promise.all([sha256Hex(poster), sha256Hex(regionMask)])
  if (posterSha !== recipe.source.poster.sha256 || maskSha !== recipe.source.regionMask.sha256)
    throw new Error('Recipe image digest does not match its bytes.')
  const posterHeader = parsePngHeader(poster, 'poster')
  const maskHeader = parsePngHeader(regionMask, 'mask')
  if (
    posterHeader.width !== recipe.source.width ||
    posterHeader.height !== recipe.source.height ||
    maskHeader.width !== recipe.source.width ||
    maskHeader.height !== recipe.source.height
  )
    throw new Error('Recipe image dimensions do not match the declared dimensions.')

  const settings = recipe.settings
  const assembled = await assemblePayload(imaging, {
    posterBytes: poster,
    maskBytes: regionMask,
    transparentBlank: recipe.source.transparentBlank,
    content: recipe.content,
    placement: recipe.placement,
    ...settings,
  })
  const png = assembled.artifacts[artifact]
  if (!png) throw new Error(`Renderer did not produce ${artifact}.`)
  return { png, filename: artifact }
}
