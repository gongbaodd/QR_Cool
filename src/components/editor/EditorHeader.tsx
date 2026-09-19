import Link from 'next/link'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../styles/tokens.stylex'

const styles = stylex.create({
  header: {
    minHeight: 88,
    display: 'flex',
    gap: 26,
    alignItems: 'center',
    paddingBlock: 14,
    paddingInline: 40,
    backgroundColor: tokens.card,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 1000px)': {
      paddingBlock: 12,
      paddingInline: 24,
    },
    '@media (max-width: 700px)': {
      minHeight: 70,
      paddingBlock: 10,
      paddingInline: 18,
    },
  },
  wordmark: {
    display: 'inline-block',
    paddingInline: 8,
    outlineOffset: 3,
    fontSize: 30,
    lineHeight: 1,
    letterSpacing: '0.01em',
    color: tokens.ink,
    textDecoration: 'none',
    borderRadius: tokens.sketch,
    boxShadow: `0 -13px ${tokens.highlight} inset`,
    transform: 'rotate(-1.2deg)',
    ':focus-visible': {
      outlineWidth: 3,
      outlineStyle: 'dashed',
      outlineColor: tokens.green,
    },
  },
  wordmarkSlash: {
    color: tokens.green,
  },
  headerNote: {
    fontSize: 17,
    paddingInlineStart: 26,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: 'dashed',
    borderInlineStartColor: tokens.ink,
    transform: 'rotate(0.3deg)',
    '@media (max-width: 1000px)': {
      display: 'none',
    },
  },
  localNote: {
    marginInlineStart: 'auto',
    fontSize: 15,
    color: tokens.muted,
    '@media (max-width: 700px)': {
      fontSize: 13,
    },
  },
})

export default function EditorHeader() {
  return (
    <header {...stylex.props(styles.header)}>
      <Link href="/" {...stylex.props(styles.wordmark)}>
        QR<span {...stylex.props(styles.wordmarkSlash)}> / </span>COOL
      </Link>
      <span {...stylex.props(styles.headerNote)}>The artistic poster editor</span>
      <span {...stylex.props(styles.localNote)}>No account. No saved uploads.</span>
    </header>
  )
}
