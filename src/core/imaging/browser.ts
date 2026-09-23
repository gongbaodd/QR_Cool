/**
 * The browser imaging backend: @jsquash/png for the lossless PNG codec and
 * @resvg/resvg-wasm as the SVG rasterizer. Pixel work (composite, flatten,
 * nearest resize) shares the pure-TS helpers in pixels.ts so both environments
 * implement the same document semantics.
 *
 * The WASM binaries are initialized lazily on the first operation. In a browser
 * bundle both codecs auto-resolve their `.wasm` assets relative to their own
 * module URL; in Node (parity harness) pass the raw wasm bytes via
 * {@link installBrowserImaging}.
 */

import { decode as pngDecodeWasm, encode as pngEncodeWasm } from '@jsquash/png'
import { init as initPngCodec } from '@jsquash/png/decode.js'
import type { InitInput as PngWasmInput } from '@jsquash/png/codec/pkg/squoosh_png.js'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import type { InitInput as ResvgWasmInput } from '@resvg/resvg-wasm'
import { QrPosterError } from '@/core/errors'
import { compositeOver, flattenOverWhite, resizeNearest } from './pixels'
import type { Imaging, RawImage, RenderedSvgPng, SvgRenderOptions } from './types'

/** Mirrors sharp's `limitInputPixels` on the Node backend. */
const PNG_DECODE_PIXEL_LIMIT = 16_000_000

export interface BrowserImagingOptions {
  /** resvg wasm source; defaults to the codec's bundled URL in browser builds. */
  resvgWasm?: ResvgWasmInput
  /** jSquash png wasm source; defaults to the codec's bundled URL in browser builds. */
  pngWasm?: PngWasmInput
}

let initialized: Promise<void> | null = null

/** Pre-initializes the codec WASMs; call once per worker/entry point. */
export function installBrowserImaging(options: BrowserImagingOptions = {}): Promise<void> {
  if (initialized) {
    if (!options.resvgWasm && !options.pngWasm) return initialized
    return Promise.reject(new Error('The browser imaging backend is already initialized.'))
  }
  initialized = Promise.all([
    initWasm(options.resvgWasm as ResvgWasmInput),
    initPngCodec(options.pngWasm as PngWasmInput),
  ]).then(() => undefined)
  return initialized
}

/**
 * Turbopack emits the wasm binaries as assets and returns their URLs. The
 * `@resvg/resvg-wasm` default auto-init cannot run under Turbopack: it relies on
 * `import.meta.url`, which the bundler replaces with `void 0`, so its internal
 * `new URL('index_bg.wasm', void 0)` throws Invalid URL. We import both assets
 * explicitly and hand the URLs to the inits instead.
 */
async function defaultWasmInputs(): Promise<BrowserImagingOptions> {
  const [resvgAsset, pngAsset] = await Promise.all([
    import('@resvg/resvg-wasm/index_bg.wasm'),
    import('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
  ])
  const resvgUrl = (resvgAsset as { default: string }).default
  const pngUrl = (pngAsset as unknown as { default: string }).default
  return {
    resvgWasm: fetch(resvgUrl) as unknown as ResvgWasmInput,
    pngWasm: fetch(pngUrl) as unknown as PngWasmInput,
  }
}

function ensureInit(): Promise<void> {
  if (!initialized) {
    initialized = defaultWasmInputs()
      .then((options) =>
        Promise.all([initWasm(options.resvgWasm as ResvgWasmInput), initPngCodec(options.pngWasm as PngWasmInput)]),
      )
      .then(() => undefined)
  }
  return initialized
}

interface RgbaLike {
  data: Uint8Array
  width: number
  height: number
}

/** Encodes RGBA pixels through @jsquash/png (it requires an exact-size buffer). */
async function encodeRgba(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const imageData = { data: new Uint8Array(data), width, height } as unknown as ImageData
  const png = await pngEncodeWasm(imageData)
  return new Uint8Array(png)
}

/** Renders at the SVG's intrinsic size, returning the pixel raster. */
async function renderResvgIntrinsic(svg: string): Promise<RgbaLike> {
  await ensureInit()
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: false },
  })
  const rendered = renderer.render()
  const result = { data: new Uint8Array(rendered.pixels), width: rendered.width, height: rendered.height }
  renderer.free()
  return result
}

/** Renders and enforces exact target dimensions, mirroring the call-site checks. */
async function renderResvg(svg: string, width: number, height: number, what: string): Promise<RgbaLike> {
  const raw = await renderResvgIntrinsic(svg)
  if (raw.width !== width || raw.height !== height) {
    throw new QrPosterError(
      'IMAGE_PROCESSING_FAILED',
      `${what} produced ${raw.width}x${raw.height} instead of ${width}x${height}.`,
      3,
    )
  }
  return raw
}

export const browserImaging: Imaging = {
  async decodePng(file: Uint8Array): Promise<RawImage> {
    try {
      const bytes = new Uint8Array(file)
      const imageData = (await pngDecodeWasm(bytes.buffer)) as unknown as RgbaLike
      const { width, height } = imageData
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
        throw new Error('undecodable PNG dimensions')
      if (width * height > PNG_DECODE_PIXEL_LIMIT) throw new Error('exceeds the pixel limit')
      return { data: new Uint8Array(imageData.data), width, height }
    } catch (error) {
      throw new QrPosterError('INVALID_INPUT', 'Could not decode the image as PNG.', 2, { cause: error })
    }
  },

  async encodePngRgba(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    return encodeRgba(data, width, height)
  },

  async encodePngGrayscale(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    // Expand one byte per pixel to opaque gray RGBA; PNG bytes differ between encoders,
    // decoded pixels do not.
    const rgba = new Uint8Array(width * height * 4)
    for (let index = 0; index < data.length; index++) {
      const value = data[index]!
      rgba[index * 4] = value
      rgba[index * 4 + 1] = value
      rgba[index * 4 + 2] = value
      rgba[index * 4 + 3] = 255
    }
    return encodeRgba(rgba, width, height)
  },

  async rasterizeSvg(svg: string, width: number, height: number): Promise<RawImage> {
    return renderResvg(svg, width, height, 'SVG rasterization')
  },

  async renderSvgToPng(svg: string, options: SvgRenderOptions): Promise<RenderedSvgPng> {
    const raw = await renderResvgIntrinsic(svg)
    const pixels = options.flatten ? flattenOverWhite(raw.data) : raw.data
    const png = await encodeRgba(pixels, raw.width, raw.height)
    return { png, width: raw.width, height: raw.height }
  },

  async composeQrPng(basePng: Uint8Array, overlaySvgs: string[]): Promise<Uint8Array> {
    const base = await this.decodePng(basePng)
    const overlays = overlaySvgs.filter((svg) => svg.length > 0)
    const rasters: RawImage[] = []
    for (const svg of overlays)
      rasters.push(await renderResvg(svg, base.width, base.height, 'QR overlay rasterization'))
    const composited = overlays.length > 0 ? compositeOver(base, rasters) : Uint8Array.from(base.data)
    return encodeRgba(composited, base.width, base.height)
  },

  async normalizeQrPng(file: Uint8Array, targetSize: number): Promise<Uint8Array> {
    const source = await this.decodePng(file)
    const flattened = flattenOverWhite(source.data)
    const resized =
      source.width === targetSize
        ? flattened
        : resizeNearest({ data: flattened, width: source.width, height: source.height }, targetSize, targetSize)
    return encodeRgba(resized, targetSize, targetSize)
  },

  async sha256Hex(input: string | Uint8Array): Promise<string> {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer)
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  },
}
