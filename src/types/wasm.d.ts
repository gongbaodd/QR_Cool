/** Turbopack `type: 'asset'` imports for wasm binaries (see next.config.ts). */
declare module '*.wasm' {
  const url: string
  export default url
}
