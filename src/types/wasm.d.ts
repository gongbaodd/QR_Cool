/** Turbopack `type: 'asset'` imports for wasm binaries (see next.config.ts). */
declare module '*.wasm' {
  const wasm: string | WebAssembly.Module
  export default wasm
}
