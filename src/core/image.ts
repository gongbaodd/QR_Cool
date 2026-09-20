import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { imaging } from './imaging'
import { QrPosterError } from './errors'

export interface LoadedPng {
  path: string
  file: Uint8Array
  data: Uint8Array
  width: number
  height: number
  sha256: string
}

export async function loadPng(path: string, label: string): Promise<LoadedPng> {
  if (extname(path).toLowerCase() !== '.png')
    throw new QrPosterError('INVALID_INPUT', `${label} must be a PNG file: ${path}`)

  let file: Uint8Array
  try {
    file = await readFile(path)
  } catch (error) {
    throw new QrPosterError('INVALID_INPUT', `Could not read ${label}: ${path}`, 2, { cause: error })
  }

  return decodePng(file, path, label)
}

/** Decodes an in-memory PNG into the same shape {@link loadPng} returns. */
export async function decodePng(file: Uint8Array, path: string, label: string): Promise<LoadedPng> {
  try {
    const raw = await imaging().decodePng(file)
    return {
      path,
      file,
      data: raw.data,
      width: raw.width,
      height: raw.height,
      sha256: await imaging().sha256Hex(file),
    }
  } catch (error) {
    throw new QrPosterError('INVALID_INPUT', `Could not decode ${label} as PNG: ${path}`, 2, { cause: error })
  }
}

export async function rgbaToPng(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  return imaging().encodePngRgba(data, width, height)
}

export async function grayscaleToPng(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  return imaging().encodePngGrayscale(data, width, height)
}

export function luma(r: number, g: number, b: number): number {
  return Math.round((299 * r + 587 * g + 114 * b) / 1000)
}
