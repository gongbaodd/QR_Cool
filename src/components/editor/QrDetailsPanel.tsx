'use client'
import * as stylex from '@stylexjs/stylex'
import type { Settings } from '@/lib/editor/schema'
import PatternSettings from './PatternSettings'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  meta: {
    padding: 18,
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  content: { overflowWrap: 'anywhere', color: tokens.muted, fontSize: 15, margin: 0 },
})

export default function QrDetailsPanel({
  content,
  settings,
  onSettings,
  onNewSeed,
  error,
}: {
  content: string
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
  onNewSeed: () => void
  error?: string | null
}) {
  return (
    <section {...stylex.props(styles.panel)} aria-labelledby="qr-details-title">
      <div {...stylex.props(styles.meta)}>
        <span {...stylex.props(ui.eyebrow)}>QR DETAILS</span>
        <h2 id="qr-details-title" {...stylex.props(ui.sectionHeading)}>
          QR details
        </h2>
        <p {...stylex.props(styles.content)}>{content || 'No committed content yet. Click Generate to begin.'}</p>
        {error && (
          <p {...stylex.props(ui.error)} role="alert">
            {error}
          </p>
        )}
      </div>
      <PatternSettings content={content} settings={settings} onSettings={onSettings} onNewSeed={onNewSeed} />
    </section>
  )
}
