import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const babelConfig = require('./babel.config.json')

export default {
  plugins: {
    '@stylexjs/postcss-plugin': {
      include: [
        'src/app/**/*.{js,jsx,ts,tsx}',
        'src/components/**/*.{js,jsx,ts,tsx}',
        'src/styles/**/*.{js,jsx,ts,tsx}',
      ],
      babelConfig: {
        babelrc: false,
        parserOpts: { plugins: ['typescript', 'jsx'] },
        plugins: babelConfig.plugins,
      },
      useCSSLayers: true,
    },
    autoprefixer: {},
  },
}
