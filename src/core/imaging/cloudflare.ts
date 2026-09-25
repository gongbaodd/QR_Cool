import type { InitInput as PngWasmInput } from '@jsquash/png/codec/pkg/squoosh_png.js'
// Cloudflare bundles this import as a WebAssembly.Module; the package's adjacent
// declaration describes the wasm-bindgen JavaScript exports instead.
// @ts-expect-error Worker WASM module import is typed by src/types/wasm.d.ts.
import pngWasm from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm'
import type { InitInput as ResvgWasmInput } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import { setImaging } from './index'
import { browserImaging, installBrowserImaging } from './browser'

/** Installs the same codec backend used in the browser worker using bundled Worker WASM modules. */
export const cloudflareImagingReady = installBrowserImaging({
  resvgWasm: resvgWasm as ResvgWasmInput,
  pngWasm: pngWasm as PngWasmInput,
}).then(() => setImaging(browserImaging))
