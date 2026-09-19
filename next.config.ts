import type { NextConfig } from 'next'
const config: NextConfig = {
  serverExternalPackages: ['sharp', '@zxing/library', 'jsqr'],
}
export default config
