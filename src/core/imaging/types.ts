/**
 * Environment-agnostic imaging seam. Core modules call these operations instead of
 * using sharp (or any other rasterizer) directly, so a Node (sharp) and a browser
 * backend can be swapped without touching pipeline logic.
 *
 * Semantics each backend must honor:
 * - `decodePng` is strict and exact: RGBA pixels, failing loudly on undecodable input.
 * - `rasterizeSvg` returns unpremultiplied RGBA; antialiased edges may differ between
 *   rasterizers (librsvg here, the browser rasterizer later), which the poster has always
 *   treated as renderer freedom.
 */

/** A decoded raster of unpremultiplied RGBA pixels. */
export interface RawImage {
  data: Uint8Array
  width: number
  height: number
}

/** Result of rasterizing an SVG straight to PNG bytes. */
export interface RenderedSvgPng {
  png: Uint8Array
  width: number
  height: number
}

export interface SvgRenderOptions {
  /** Composites the raster over opaque white before encoding (plain alpha otherwise). */
  flatten?: boolean
}

export interface Imaging {
  /** Strict PNG decode into exact RGBA. */
  decodePng(file: Uint8Array): Promise<RawImage>

  /** Encodes RGBA pixels into PNG bytes. */
  encodePngRgba(data: Uint8Array, width: number, height: number): Promise<Uint8Array>

  /** Encodes a one-byte-per-pixel grayscale raster into PNG bytes. */
  encodePngGrayscale(data: Uint8Array, width: number, height: number): Promise<Uint8Array>

  /** Rasterizes an SVG at the exact size into RGBA pixels. */
  rasterizeSvg(svg: string, width: number, height: number): Promise<RawImage>

  /** Rasterizes an SVG into PNG bytes, optionally flattened over opaque white. */
  renderSvgToPng(svg: string, options: SvgRenderOptions): Promise<RenderedSvgPng>

  /** Composites SVG overlays (rasterized at the base size) over a base PNG into PNG bytes. */
  composeQrPng(basePng: Uint8Array, overlaySvgs: string[]): Promise<Uint8Array>

  /** Flattens alpha over white, nearest-resamples to a square target size, returns PNG bytes. */
  normalizeQrPng(file: Uint8Array, targetSize: number): Promise<Uint8Array>

  /** SHA-256 hex of bytes or a UTF-8 string. Async so the browser's crypto.subtle fits. */
  sha256Hex(input: string | Uint8Array): Promise<string>
}
