'use client'
import Link from 'next/link'
import type { RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { QR_EXAMPLES } from '@/lib/editor/examples'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  header: {
    position: 'sticky',
    insetBlockStart: 0,
    zIndex: 5,
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gap: 20,
    alignItems: 'center',
    paddingBlock: 12,
    paddingInline: 28,
    backgroundColor: tokens.card,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 900px)': { gridTemplateColumns: '1fr', gap: 8, paddingInline: 16 },
  },
  wordmark: {
    display: 'inline-block',
    paddingInline: 8,
    outlineOffset: 3,
    fontSize: 30,
    lineHeight: 1,
    color: tokens.ink,
    textDecoration: 'none',
    borderRadius: tokens.sketch,
    boxShadow: `0 -13px ${tokens.highlight} inset`,
    transform: 'rotate(-1.2deg)',
    ':focus-visible': { outlineWidth: 3, outlineStyle: 'dashed', outlineColor: tokens.green },
  },
  slash: { color: tokens.green },
  form: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'end', minWidth: 0 },
  field: { fontSize: 16, marginTop: 0 },
  submit: { minHeight: 48, whiteSpace: 'nowrap' },
  meta: { minWidth: 150, fontSize: 14, color: tokens.muted, lineHeight: 1.35 },
  examples: { gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: -2 },
  example: {
    paddingBlock: 3,
    paddingInline: 8,
    fontSize: 13,
    backgroundColor: 'white',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  status: { gridColumn: '1 / -1', fontSize: 14, color: tokens.muted, minHeight: 20, margin: 0 },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
})

export default function EditorHeader({
  content,
  contentError,
  busy,
  status,
  onContentChange,
  onContentBlur,
  onSubmit,
  inputRef,
}: {
  content: string
  contentError: string | null
  busy: boolean
  status: string
  onContentChange: (value: string) => void
  onContentBlur: () => void
  onSubmit: () => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  return (
    <header {...stylex.props(styles.header)}>
      <Link href="/" {...stylex.props(styles.wordmark)}>
        QR<span {...stylex.props(styles.slash)}> / </span>COOL
      </Link>
      <form
        {...stylex.props(styles.form)}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label {...stylex.props(ui.label)} htmlFor="content">
          Text or URL
          <input
            {...stylex.props(ui.field, styles.field)}
            id="content"
            ref={inputRef}
            name="content"
            type="text"
            inputMode="url"
            enterKeyHint="go"
            value={content}
            maxLength={2048}
            aria-invalid={!!contentError}
            aria-describedby={contentError ? 'content-error' : 'content-hint'}
            onBlur={onContentBlur}
            onChange={(event) => onContentChange(event.target.value)}
          />
        </label>
        <button {...stylex.props(ui.button, ui.primary, styles.submit)} type="submit" disabled={busy}>
          {busy ? 'Applying…' : 'Generate'}
        </button>
        <p id="content-hint" {...stylex.props(styles.status)} role="status">
          {status}
        </p>
        {contentError && (
          <span id="content-error" {...stylex.props(styles.srOnly)}>
            {contentError}
          </span>
        )}
        <div {...stylex.props(styles.examples)}>
          {QR_EXAMPLES.map((example) => (
            <button
              key={example.value}
              type="button"
              {...stylex.props(styles.example)}
              onClick={() => onContentChange(example.value)}
            >
              {example.label}
            </button>
          ))}
        </div>
      </form>
      <span {...stylex.props(styles.meta)}>
        Local processing.
        <br />
        No account or saved uploads.
      </span>
    </header>
  )
}
