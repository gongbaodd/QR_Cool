import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library'
import jsQR from 'jsqr'
import type { QRCode as JsQrResult } from 'jsqr'
import sharp from 'sharp'
import { QrPosterError } from './errors.js'
import type { LoadedPng } from './image.js'
import { luma } from './image.js'
import type { QrMetadata, VerificationCheck } from './types.js'

const QUIET_ZONE_MODULES = 2 as const

export async function decodeQrBuffer(buffer: Buffer): Promise<string> {
  return (await decodeQrBufferDetailed(buffer)).text
}

export interface DecodedQr {
  text: string
  decoder: 'zxing' | 'jsqr'
  version?: number
}

async function decodeQrBufferDetailed(buffer: Buffer): Promise<DecodedQr> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return decodeQrRawDetailed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), info.width, info.height)
}

export function decodeQrRaw(data: Uint8Array, width: number, height: number): string {
  return decodeQrRawDetailed(data, width, height).text
}

export function decodeQrRawDetailed(data: Uint8Array, width: number, height: number): DecodedQr {
  const pixels = Uint8ClampedArray.from(data)
  try {
    const source = new RGBLuminanceSource(pixels, width, height)
    const bitmap = new BinaryBitmap(new HybridBinarizer(source))
    const hints = new Map<DecodeHintType, unknown>([
      [DecodeHintType.TRY_HARDER, true],
      [DecodeHintType.CHARACTER_SET, 'UTF-8'],
    ])
    return { text: new QRCodeReader().decode(bitmap, hints).getText(), decoder: 'zxing' }
  }
  catch (zxingError) {
    const fallback = (jsQR as unknown as (
      data: Uint8ClampedArray,
      width: number,
      height: number,
      options: { inversionAttempts: 'attemptBoth' },
    ) => JsQrResult | null)(pixels, width, height, { inversionAttempts: 'attemptBoth' })
    if (fallback)
      return { text: fallback.data, decoder: 'jsqr', version: fallback.version }
    throw new QrPosterError('QR_INVALID', 'The QR code could not be decoded by ZXing or jsQR.', 2, { cause: zxingError })
  }
}

export function inspectAntfuQr(image: LoadedPng, decodedText: string, detectedVersion?: number): QrMetadata {
  if (image.width !== image.height)
    throw new QrPosterError('QR_INVALID', `QR image must be square; received ${image.width}x${image.height}.`)

  const candidates: Array<{ version: number; qrModules: number; totalModules: number; cell: number; lightRatio: number }> = []
  for (let version = 1; version <= 40; version++) {
    const qrModules = 21 + 4 * (version - 1)
    const totalModules = qrModules + QUIET_ZONE_MODULES * 2
    if (image.width % totalModules !== 0)
      continue
    const cell = image.width / totalModules
    const lightRatio = quietZoneLightRatio(image.data, image.width, image.height, QUIET_ZONE_MODULES * cell)
    if (cell >= 1 && lightRatio >= 0.98 && (detectedVersion === undefined || version === detectedVersion))
      candidates.push({ version, qrModules, totalModules, cell, lightRatio })
  }

  if (candidates.length !== 1) {
    throw new QrPosterError(
      'QR_INVALID',
      `QR dimensions do not uniquely match the qrcode.antfu.me two-module quiet-zone profile (found ${candidates.length} candidates).`,
    )
  }

  const candidate = candidates[0]!
  return {
    width: image.width,
    height: image.height,
    decodedText,
    version: candidate.version,
    qrModules: candidate.qrModules,
    quietZoneModules: QUIET_ZONE_MODULES,
    totalModules: candidate.totalModules,
    sourceModulePixels: candidate.cell,
    quietZoneLightRatio: candidate.lightRatio,
  }
}

export async function normalizeQr(image: LoadedPng, targetSize: number): Promise<Buffer> {
  return sharp(image.file)
    .flatten({ background: '#ffffff' })
    .resize(targetSize, targetSize, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer()
}

export async function verifyQrVariant(name: VerificationCheck['name'], buffer: Buffer, expectedText: string): Promise<VerificationCheck> {
  try {
    const decoded = await decodeQrBufferDetailed(buffer)
    if (decoded.text !== expectedText) {
      return {
        name,
        passed: false,
        decodedText: decoded.text,
        decoder: decoded.decoder,
        ...(decoded.version !== undefined ? { version: decoded.version } : {}),
        error: `Decoded content differs from the expected text.`,
      }
    }
    return {
      name,
      passed: true,
      decodedText: decoded.text,
      decoder: decoded.decoder,
      ...(decoded.version !== undefined ? { version: decoded.version } : {}),
    }
  }
  catch (error) {
    return {
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function quietZoneLightRatio(data: Uint8Array, width: number, height: number, marginPixels: number): number {
  let light = 0
  let total = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= marginPixels && x < width - marginPixels && y >= marginPixels && y < height - marginPixels)
        continue
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3]!
      const brightness = luma(data[offset]!, data[offset + 1]!, data[offset + 2]!)
      if (alpha < 16 || brightness >= 200)
        light++
      total++
    }
  }
  return total === 0 ? 0 : light / total
}
