import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import sharp from 'sharp'
import { QrPosterError } from './errors.js'

export interface LoadedPng {
  path: string
  file: Buffer
  data: Uint8Array
  width: number
  height: number
  sha256: string
}

export async function loadPng(path: string, label: string): Promise<LoadedPng> {
  if (extname(path).toLowerCase() !== '.png')
    throw new QrPosterError('INVALID_INPUT', `${label} must be a PNG file: ${path}`)

  let file: Buffer
  try {
    file = await readFile(path)
  }
  catch (error) {
    throw new QrPosterError('INVALID_INPUT', `Could not read ${label}: ${path}`, 2, { cause: error })
  }

  return decodePng(file, path, label)
}

/** Decodes an in-memory PNG into the same shape {@link loadPng} returns. */
export async function decodePng(file: Buffer, path: string, label: string): Promise<LoadedPng> {
  try {
    const source = sharp(file, { failOn: 'error' })
    const metadata = await source.metadata()
    if (metadata.format !== 'png' || !metadata.width || !metadata.height)
      throw new Error('not a decodable PNG')
    const { data, info } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return {
      path,
      file,
      data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      width: info.width,
      height: info.height,
      sha256: createHash('sha256').update(file).digest('hex'),
    }
  }
  catch (error) {
    throw new QrPosterError('INVALID_INPUT', `Could not decode ${label} as PNG: ${path}`, 2, { cause: error })
  }
}

export function rgbaToPng(data: Uint8Array, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

export function grayscaleToPng(data: Uint8Array, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer()
}

export function luma(r: number, g: number, b: number): number {
  return Math.round((299 * r + 587 * g + 114 * b) / 1000)
}
