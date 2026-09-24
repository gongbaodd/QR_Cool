'use client'
import Link from 'next/link'
import { useState } from 'react'
import type { RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { QR_EXAMPLES } from '@/lib/editor/examples'
import type { ContentKind } from '@/lib/editor/content-input'
import { buildSimpleContent } from '@/lib/editor/content-input'
import ContentInputDialog from './ContentInputDialog'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  header: {
    position: 'sticky',
    insetBlockStart: 0,
    zIndex: 5,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 20,
    alignItems: 'center',
    paddingBlock: 12,
    paddingInline: 28,
    backgroundColor: tokens.card,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 56.25em)': { gridTemplateColumns: '1fr', gap: 8, paddingInline: 16 },
  },
  wordmark: {
    display: 'inline-flex',
    alignItems: 'center',
    paddingInline: 8,
    outlineOffset: 3,
    color: tokens.ink,
    textDecoration: 'none',
    borderRadius: tokens.sketch,
    marginInlineStart: 'auto',
  },
  mark: {
    display: 'block',
    flexShrink: 0,
    width: 'clamp(2.75rem, 5vw, 3.5rem)',
    height: 'clamp(2.75rem, 5vw, 3.5rem)',
  },
  form: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, alignItems: 'end', minWidth: 0 },
  field: { fontSize: '1rem', marginTop: 0 },
  kinds: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
  },
  kindLegend: {
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
  kind: {
    paddingBlock: 4,
    paddingInline: 9,
    fontSize: '0.875rem',
    backgroundColor: 'white',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  kindSelected: { backgroundColor: tokens.accentSoft, borderWidth: 2, paddingBlock: 3, paddingInline: 8 },
  openDialog: { justifySelf: 'start', fontSize: '0.9375rem' },
  localError: { display: 'block', marginTop: 6, color: tokens.danger, fontSize: '0.875rem', lineHeight: 1.4 },
  meta: { minWidth: 150, fontSize: '0.875rem', color: tokens.inkMuted, lineHeight: 1.35 },
  examples: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: -2,
  },
  example: {
    paddingBlock: 3,
    paddingInline: 8,
    fontSize: '0.8125rem',
    backgroundColor: 'white',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  status: { gridColumn: '1 / -1', fontSize: '0.875rem', color: tokens.inkMuted, minHeight: 20, margin: 0 },
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
  contentError,
  status,
  onContentChange,
  onContentBlur,
  onSubmit,
  onContentInvalid,
  inputRef,
}: {
  contentError: string | null
  status: string
  onContentChange: (value: string) => void
  onContentBlur: () => void
  onSubmit: () => void
  onContentInvalid: () => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const [kind, setKind] = useState<ContentKind>('URL')
  const [dialogKind, setDialogKind] = useState<ContentKind | null>(null)
  const [simpleTouched, setSimpleTouched] = useState(false)
  const [simpleValues, setSimpleValues] = useState<Record<'URL' | 'Text' | 'Phone', string>>({
    URL: '',
    Text: '',
    Phone: '',
  })

  function selectKind(next: ContentKind) {
    setKind(next)
    setSimpleTouched(false)
    if (next === 'URL' || next === 'Text' || next === 'Phone') {
      setDialogKind(null)
      const value = buildSimpleContent(next, simpleValues[next])
      if (value) onContentChange(value)
      else onContentInvalid()
    } else {
      onContentInvalid()
      setDialogKind(next)
    }
  }

  function handleSimpleChange(value: string) {
    if (kind !== 'URL' && kind !== 'Text' && kind !== 'Phone') return
    setSimpleValues((current) => ({ ...current, [kind]: value }))
    const content = buildSimpleContent(kind, value)
    if (content) onContentChange(content)
    else onContentInvalid()
  }

  function handleExample(value: string) {
    const next: 'URL' | 'Text' = value.startsWith('http://') || value.startsWith('https://') ? 'URL' : 'Text'
    setKind(next)
    setDialogKind(null)
    setSimpleTouched(false)
    setSimpleValues((current) => ({ ...current, [next]: value }))
    onContentChange(value)
  }

  function submitSimple() {
    if (!simpleKind) return
    const value = buildSimpleContent(simpleKind, simpleValues[simpleKind])
    if (!value) {
      setSimpleTouched(true)
      onContentInvalid()
      return
    }
    onContentChange(value)
    onSubmit()
  }

  const simpleKind = kind === 'URL' || kind === 'Text' || kind === 'Phone' ? kind : null
  const activeSimpleValue = simpleKind ? simpleValues[simpleKind] : ''
  const simpleError =
    simpleKind && simpleTouched && !buildSimpleContent(simpleKind, activeSimpleValue)
      ? simpleKind === 'URL'
        ? 'Enter an absolute http or https URL.'
        : simpleKind === 'Phone'
          ? 'Enter a phone number with at least three digits.'
          : 'Enter one line of text within the QR capacity limit.'
      : null

  return (
    <header {...stylex.props(styles.header)}>
      <form
        {...stylex.props(styles.form)}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submitSimple()
        }}
      >
        {simpleKind ? (
          <label {...stylex.props(ui.label)} htmlFor="content">
            {simpleKind}
            <input
              {...stylex.props(ui.field, ui.focusVisible, styles.field)}
              id="content"
              ref={inputRef}
              name="content"
              type="text"
              inputMode={simpleKind === 'URL' ? 'url' : simpleKind === 'Phone' ? 'tel' : 'text'}
              autoComplete={simpleKind === 'Phone' ? 'tel' : 'off'}
              enterKeyHint="go"
              value={simpleValues[simpleKind]}
              maxLength={8000}
              aria-invalid={!!contentError || !!simpleError}
              aria-describedby={simpleError || contentError ? 'content-error' : 'content-hint'}
              onBlur={() => {
                setSimpleTouched(true)
                if (buildSimpleContent(simpleKind, activeSimpleValue)) onContentBlur()
                else onContentInvalid()
              }}
              onChange={(event) => handleSimpleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                submitSimple()
              }}
            />
            {simpleError && (
              <span id="content-error" {...stylex.props(styles.localError)}>
                {simpleError}
              </span>
            )}
          </label>
        ) : (
          <button
            type="button"
            {...stylex.props(ui.button, ui.focusVisible, ui.textButton, styles.openDialog)}
            onClick={() => setDialogKind(kind)}
          >
            Edit {kind} details
          </button>
        )}
        <fieldset {...stylex.props(styles.kinds)} aria-label="QR content type">
          <legend {...stylex.props(styles.kindLegend)}>QR content type</legend>
          {(['URL', 'Text', 'Phone', 'WiFi', 'SMS', 'Email', 'QRCode'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={kind === choice}
              {...stylex.props(styles.kind, kind === choice && styles.kindSelected, ui.focusVisible)}
              onClick={() => selectKind(choice)}
            >
              {choice}
            </button>
          ))}
        </fieldset>
        <p id="content-hint" {...stylex.props(styles.status)} role="status">
          {status}
        </p>
        {contentError && !simpleError && (
          <span id="content-error" {...stylex.props(styles.srOnly)}>
            {contentError}
          </span>
        )}
        <div {...stylex.props(styles.examples)}>
          {QR_EXAMPLES.map((example) => (
            <button
              key={example.value}
              type="button"
              {...stylex.props(styles.example, ui.focusVisible)}
              onClick={() => handleExample(example.value)}
            >
              {example.label}
            </button>
          ))}
          <Link href="/" aria-label="Home" {...stylex.props(styles.wordmark, ui.focusVisible)}>
            <img {...stylex.props(styles.mark)} src="/brand/mahu-tiger.svg" alt="" width={56} height={56} />
          </Link>
        </div>
      </form>
      <ContentInputDialog
        kind={dialogKind}
        onClose={() => setDialogKind(null)}
        onContentChange={onContentChange}
        onSubmit={onSubmit}
        onContentInvalid={onContentInvalid}
      />
    </header>
  )
}
