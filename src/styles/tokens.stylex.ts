import * as stylex from '@stylexjs/stylex'

/**
 * mahu-QR's palette on the Wired-Elements sketch geometry: the mascot's two flat
 * inks (near-black `#101211` and vermilion `#ff321e`) on warm cream, the original
 * hand-drawn multi-corner radii, hard offset shadows, and the original
 * handwriting UI stack. StyleX compiles these into CSS custom properties, so
 * every value below has exactly one home. The two brand inks mirror
 * `public/brand/mahu-tiger.svg`.
 */
export const tokens = stylex.defineVars({
  ink: '#101211',
  inkMuted: '#5f6663',
  paper: '#fdf8f2',
  card: '#ffffff',
  accent: '#ff321e',
  /** Highlighter swipes and button fills (was `highlight`). */
  accentSoft: '#ffe4de',
  /** Slider fill derived from vermilion in OKLCH (L 0.90, 15% source chroma, same hue). */
  accentSliderFill: '#f5d6d0',
  /** Hover fills (was `highlightSoft`). */
  accentSoftest: '#fff1ed',
  /** AA-safe vermilion for body-size text (`#ff321e` is borders/large text only). */
  accentText: '#c22312',
  /** Canvas "placement fits" signal — kept distinct from the brand vermilion. */
  valid: '#0b7a5e',
  validSoft: '#e6f4ee',
  danger: '#af2536',
  dangerSoft: '#fff1f2',
  sketch: '255px 18px 225px 18px/18px 225px 18px 255px',
  sketchAlt: '18px 225px 18px 255px/255px 18px 255px 18px',
  sketchCard: '22px 225px 22px 255px/255px 22px 255px 22px',
  shadow: '2px 3px 0 rgba(16, 18, 17, 0.9)',
  shadowLg: '4px 6px 0 rgba(16, 18, 17, 0.85)',
  shadowField: '1px 2px 0 rgba(16, 18, 17, 0.75)',
  handFont: "'Gloria Hallelujah', 'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', cursive",
})
