import * as stylex from '@stylexjs/stylex'

/**
 * The poster editor's palette, hand-drawn geometry and type stack. StyleX compiles
 * these into CSS custom properties, so every value below has exactly one home.
 */
export const tokens = stylex.defineVars({
  ink: '#23272b',
  muted: '#5c665f',
  paper: '#fffdf8',
  card: '#ffffff',
  highlight: '#f0e6f4',
  highlightSoft: '#f7f0f9',
  green: '#08684f',
  greenSoft: '#eaf2ec',
  danger: '#af2536',
  dangerSoft: '#fff1f2',
  sketch: '255px 18px 225px 18px/18px 225px 18px 255px',
  sketchAlt: '18px 225px 18px 255px/255px 18px 255px 18px',
  sketchCard: '22px 225px 22px 255px/255px 22px 255px 22px',
  shadow: '2px 3px 0 rgba(35, 39, 43, 0.9)',
  shadowLg: '4px 6px 0 rgba(35, 39, 43, 0.85)',
  shadowField: '1px 2px 0 rgba(35, 39, 43, 0.75)',
  handFont: "'Gloria Hallelujah', 'Comic Sans MS', 'Chalkboard SE', 'Segoe Print', cursive",
})
