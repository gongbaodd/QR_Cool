/** Bundlers expose Worker WASM as an asset URL in the browser or a module in Cloudflare. */
declare module '*.wasm' {
  const wasm: string | WebAssembly.Module
  export default wasm
}
