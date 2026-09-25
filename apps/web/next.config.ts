import type { NextConfig } from 'next'
const config: NextConfig = {
  // Emit `*.wasm` as assets so the worker can `init` the codecs with the emitted URL.
  // Required: `@resvg/resvg-wasm` loses `import.meta.url` under Turbopack bundling
  // (`new URL('index_bg.wasm', void 0)`), so its default auto-init throws Invalid URL.
  // The worker passes explicit inputs instead (packages/renderer/src/core/imaging/browser.ts).
  turbopack: {
    rules: {
      '*.wasm': {
        type: 'asset',
      },
    },
  },
  serverExternalPackages: ['@zxing/library', 'jsqr'],
}
export default config
