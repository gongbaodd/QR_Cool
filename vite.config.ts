import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig, type Plugin } from 'vite'
import vinext from 'vinext'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Turns the codec binaries into plain asset URLs (`{ default: url }`), the
 * same contract as next.config.ts's Turbopack `asset` rule: browser.ts imports
 * both `.wasm` files, fetches the URLs, and hands the responses to the codecs'
 * own inits (`initWasm` / jSquash `init`), whose glue supplies the wasm-bindgen
 * imports. Without the rewrite, Vite's worker bundling compiles `.wasm` into
 * an ES module whose bare `wbg` imports nothing resolves.
 */
function wasmAssetUrls(): Plugin {
  return {
    name: 'qr-cool:wasm-asset-urls',
    enforce: 'pre',
    resolveId: {
      order: 'pre',
      async handler(source, importer) {
        if (!source.endsWith('.wasm') || source.includes('?')) return null
        const resolved = await this.resolve(source, importer, { skipSelf: true })
        if (!resolved || resolved.external) return null
        return `${resolved.id}?url`
      },
    },
  }
}

/**
 * Applies the project's StyleX Babel transform (the same plugin and options as
 * babel.config.json, which Next uses) to app source. Vite never reads
 * babel.config.json, so `stylex.create()`/`stylex.defineVars` would otherwise
 * run at runtime and throw "Unexpected 'stylex.defineVars' call at runtime" —
 * the PostCSS plugin only extracts the stylesheet, it does not rewrite JS.
 */
function stylexBabel(): Plugin {
  const srcRoot = path.resolve(here, 'src')
  return {
    name: 'qr-cool:stylex-babel',
    enforce: 'pre',
    transform: {
      order: 'pre',
      filter: { id: /\.[cm]?[jt]sx?(?:\?.*)?$/ },
      handler(code, id) {
        const cleanId = id.split('?', 1)[0]!
        if (!cleanId.startsWith(srcRoot)) return null
        const { transformSync } = require('@babel/core') as typeof import('@babel/core')
        const result = transformSync(code, {
          filename: cleanId,
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ['typescript', 'jsx'] },
          plugins: [
            [
              require.resolve('@stylexjs/babel-plugin'),
              {
                dev: false,
                runtimeInjection: false,
                enableInlinedConditionalMerge: true,
                treeshakeCompensation: true,
                aliases: {
                  '@/*': [path.join(srcRoot, '*')],
                },
                unstable_moduleResolution: { type: 'commonJS' },
              },
            ],
          ],
          sourceMaps: true,
        })
        if (!result?.code) return null
        return { code: result.code, map: result.map ?? null }
      },
    },
  }
}

/**
 * vinext (Vite) build for Cloudflare Workers. Runs alongside the Node build:
 * `pnpm dev`/`pnpm build` stay on Next.js, `pnpm dev:vinext`/`pnpm build:vinext`
 * use this config. The two toolchains share the app source, the PostCSS pipeline
 * (StyleX via postcss.config.mjs), and next.config.ts.
 *
 * vinext auto-registers @vitejs/plugin-react and @vitejs/plugin-rsc; do not add
 * them here (vinext fails the build on duplicates).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  plugins: [
    //
    wasmAssetUrls(),
    stylexBabel(),
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
  worker: {
    // The engine worker is an ES module (`new Worker(url, { type: 'module' })`)
    // and the codec WASM inits use top-level await; the default 'iife' worker
    // output cannot express either.
    format: 'es',
    // Nested worker bundling runs its own reduced plugin chain and needs the
    // asset-URL rewrite; stylexBabel is irrelevant there (no StyleX in the
    // worker) but wasmAssetUrls is not.
    plugins: () => [wasmAssetUrls()],
  },
})
