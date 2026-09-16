import type { NextConfig } from 'next'
const config: NextConfig = {
  serverExternalPackages: ['sharp', '@zxing/library', 'jsqr'],
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}
export default config
