'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { motion, useReducedMotion } from 'motion/react'
import { MOBILE_LAYOUT_QUERY } from '@/lib/editor/responsive'
import { QR_EXAMPLES } from '@/lib/editor/examples'
import type { ContentKind } from '@/lib/editor/content-input'
import { buildSimpleContent } from '@/lib/editor/content-input'
import ContentInputDialog from './ContentInputDialog'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  shell: {
    position: 'sticky',
    insetBlockStart: 0,
    zIndex: 5,
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: 20,
    alignItems: 'center',
    paddingBlock: 12,
    paddingInline: 28,
    backgroundColor: tokens.card,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.ink,
    '@media (max-width: 56.25em)': {
      position: 'sticky',
      insetBlockStart: 0,
      zIndex: 5,
      display: 'block',
      paddingBlock: 0,
      paddingInline: 0,
      backgroundColor: 'transparent',
      borderBottomWidth: 0,
      borderBottomStyle: 'none',
    },
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gridColumn: '1',
    gridRow: '1',
    '@media (max-width: 56.25em)': {
      width: '100%',
      blockSize: '3.75rem',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: 0,
      backgroundColor: tokens.card,
      borderBottomWidth: 2,
      borderBottomStyle: 'solid',
      borderBottomColor: tokens.ink,
    },
  },
  barOpen: {
    '@media (max-width: 56.25em)': { borderBottomWidth: 0, borderBottomStyle: 'none' },
  },
  wordmark: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingInline: 8,
    outlineOffset: 3,
    color: tokens.ink,
    textDecoration: 'none',
    borderRadius: tokens.sketch,
    gridColumn: '1',
    gridRow: '1',
    '@media (max-width: 56.25em)': { paddingInline: 0 },
  },
  mark: {
    display: 'block',
    flexShrink: 0,
    width: 'clamp(3.5rem, 16vw, 128px)',
    height: 'clamp(3.5rem, 16vw, 128px)',
    '@media (max-width: 56.25em)': { width: 38, height: 38 },
  },
  brandName: {
    fontFamily: tokens.handFont,
    fontSize: '1.125rem',
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    '@media (max-width: 56.25em)': { fontSize: '0.75rem', lineHeight: 1 },
  },
  mobileTrigger: {
    display: 'none',
    '@media (max-width: 56.25em)': {
      display: 'flex',
      flex: 1,
      width: 'auto',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      minWidth: 0,
      paddingBlock: 9,
      paddingInline: 13,
      borderWidth: 2,
      borderStyle: 'solid',
      borderColor: tokens.ink,
      borderRadius: tokens.sketchAlt,
      backgroundColor: 'white',
      color: tokens.ink,
      boxShadow: tokens.shadowField,
      fontFamily: 'inherit',
      fontSize: '1rem',
      lineHeight: 1.5,
      textAlign: 'start',
      cursor: 'pointer',
    },
  },
  triggerLabel: {
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  triggerIcon: {
    flexShrink: 0,
    width: 10,
    height: 10,
    borderInlineEndWidth: 2,
    borderInlineEndStyle: 'solid',
    borderBlockEndWidth: 2,
    borderBlockEndStyle: 'solid',
    borderColor: tokens.ink,
    transform: 'rotate(45deg) translateY(-2px)',
    transitionProperty: 'transform',
    transitionDuration: '180ms',
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0ms' },
  },
  triggerIconOpen: { transform: 'rotate(225deg) translate(-2px, -1px)' },
  formWrap: {
    gridColumn: '2',
    gridRow: '1',
    minWidth: 0,
    '@media (max-width: 56.25em)': {
      position: 'absolute',
      insetBlockStart: '100%',
      insetInlineStart: 0,
      width: '100%',
      boxSizing: 'border-box',
      zIndex: 1,
      gridColumn: '1',
      gridRow: '2',
      height: 0,
      maxHeight: 0,
      overflow: 'hidden',
      overflowY: 'auto',
      visibility: 'hidden',
      backgroundColor: tokens.card,
      borderBottomWidth: 0,
      borderBottomStyle: 'solid',
      borderBottomColor: tokens.ink,
    },
  },
  formWrapOpen: {
    '@media (max-width: 56.25em)': {
      maxHeight: 'calc(100dvh - 3.75rem)',
      paddingBlockEnd: 12,
      borderBottomWidth: 2,
    },
  },
  form: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 10,
    alignItems: 'end',
    minWidth: 0,
  },
  closeDisclosure: {
    display: 'none',
    justifySelf: 'center',
    placeItems: 'center',
    width: 44,
    height: 44,
    paddingBlock: 0,
    paddingInline: 0,
    '@media (max-width: 56.25em)': { display: 'grid' },
  },
  closeDisclosureIcon: {
    display: 'block',
    width: 20,
    height: 20,
  },
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
  const [contentOpen, setContentOpen] = useState(false)
  const [isMobile, setIsMobile] = useState<boolean | null>(null)
  const [simpleTouched, setSimpleTouched] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const prefersReducedMotion = useReducedMotion()
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
  const triggerText = simpleKind ? activeSimpleValue.trim() || 'Enter content…' : `Edit ${kind} details`
  const simpleError =
    simpleKind && simpleTouched && !buildSimpleContent(simpleKind, activeSimpleValue)
      ? simpleKind === 'URL'
        ? 'Enter an absolute http or https URL.'
        : simpleKind === 'Phone'
          ? 'Enter a phone number with at least three digits.'
          : 'Enter one line of text within the QR capacity limit.'
      : null

  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY)
    const update = () => {
      const nextMobile = media.matches
      setIsMobile(nextMobile)
      if (nextMobile) {
        if (formRef.current?.contains(document.activeElement)) {
          setContentOpen(false)
          requestAnimationFrame(() => triggerRef.current?.focus())
        }
      } else {
        setContentOpen(false)
        if (document.activeElement === triggerRef.current) {
          requestAnimationFrame(() => inputRef?.current?.focus())
        }
      }
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [inputRef])

  useEffect(() => {
    if (!contentOpen || !isMobile || dialogKind) return
    const frame = requestAnimationFrame(() => {
      const target = simpleKind
        ? (inputRef?.current ?? formRef.current?.querySelector<HTMLElement>('[data-content-editor-trigger]'))
        : formRef.current?.querySelector<HTMLElement>('[data-content-editor-trigger]')
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [contentOpen, dialogKind, inputRef, isMobile, simpleKind])

  function closeContent() {
    triggerRef.current?.focus()
    setContentOpen(false)
  }

  function handleDisclosureKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !contentOpen || dialogKind) return
    event.preventDefault()
    event.stopPropagation()
    closeContent()
  }

  const animateForm =
    isMobile === null
      ? undefined
      : isMobile
        ? contentOpen
          ? {
              height: 'auto' as const,
              opacity: 1,
              y: 0,
              visibility: 'visible' as const,
              maxHeight: 'calc(100dvh - 3.75rem)',
            }
          : { height: 0, opacity: 0, y: -8, visibility: 'hidden' as const, maxHeight: 0 }
        : undefined
  const motionTransition = prefersReducedMotion ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' as const }

  return (
    <div {...stylex.props(styles.shell)} onKeyDownCapture={handleDisclosureKeyDown}>
      <header {...stylex.props(styles.bar, contentOpen && styles.barOpen)}>
        <Link href="/" aria-label="Mahu QR home" {...stylex.props(styles.wordmark, ui.focusVisible)}>
          <img {...stylex.props(styles.mark)} src="/brand/mahu-tiger.svg" alt="" width={128} height={128} />
          <span {...stylex.props(styles.brandName)}>Mahu QR</span>
        </Link>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Edit QR content"
          aria-expanded={contentOpen}
          aria-controls="mobile-content-form"
          {...stylex.props(styles.mobileTrigger, ui.focusVisible)}
          onClick={() => setContentOpen((open) => !open)}
        >
          <span {...stylex.props(styles.triggerLabel)}>{triggerText}</span>
          <span aria-hidden="true" {...stylex.props(styles.triggerIcon, contentOpen && styles.triggerIconOpen)} />
        </button>
      </header>
      <motion.div
        id="mobile-content-form"
        {...stylex.props(styles.formWrap, contentOpen && styles.formWrapOpen)}
        animate={animateForm ?? false}
        transition={motionTransition}
        inert={isMobile === true && !contentOpen}
        aria-hidden={isMobile === true && !contentOpen}
      >
        <form
          ref={formRef}
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
              data-content-editor-trigger
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
          </div>
          <button
            type="button"
            aria-label="Slide up"
            {...stylex.props(ui.button, ui.focusVisible, styles.closeDisclosure)}
            onClick={closeContent}
          >
            <svg {...stylex.props(styles.closeDisclosureIcon)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 19V5m-7 7 7-7 7 7"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>
      </motion.div>
      <ContentInputDialog
        kind={dialogKind}
        onClose={() => setDialogKind(null)}
        onContentChange={onContentChange}
        onSubmit={onSubmit}
        onContentInvalid={onContentInvalid}
      />
    </div>
  )
}
