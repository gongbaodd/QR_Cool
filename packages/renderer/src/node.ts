import { nodeImaging } from './core/imaging/node'
import { Buffer } from 'node:buffer'
import { MAX_RECIPE_BYTES, renderRecipe, type PortableRecipe } from './recipe'

export type RecipeArtifact = 'poster.png' | 'qr.png'

export interface RenderRecipeOptions {
  artifact?: RecipeArtifact
  content?: string
}

export interface RenderRecipeResult {
  png: Uint8Array
  filename: RecipeArtifact
}

/** Render an already parsed editor recipe with the Node.js imaging backend. */
export async function renderRecipeJson(
  rawRecipe: unknown,
  options: RenderRecipeOptions = {},
): Promise<RenderRecipeResult> {
  const artifact = options.artifact ?? 'poster.png'
  const result = await renderRecipe(nodeImaging, rawRecipe, artifact, options.content)
  return { png: new Uint8Array(await result.png.arrayBuffer()), filename: result.filename as RecipeArtifact }
}

/**
 * Parse and render UTF-8 JSON bytes/string from the editor's recipe export.
 * Filesystem access stays with the caller so this entry never writes or reads paths.
 */
export async function renderRecipeFile(
  input: Uint8Array | string,
  options: RenderRecipeOptions = {},
): Promise<RenderRecipeResult> {
  const inputBytes = typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.byteLength
  if (inputBytes > MAX_RECIPE_BYTES) {
    throw new Error(`Recipe exceeds the ${MAX_RECIPE_BYTES}-byte size limit.`)
  }

  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const rawRecipe: unknown = JSON.parse(text)
  return renderRecipeJson(rawRecipe, options)
}

export type { PortableRecipe }
