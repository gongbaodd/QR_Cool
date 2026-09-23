import * as stylex from '@stylexjs/stylex'
import type { Result } from '@/lib/editor/state'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'

const styles = stylex.create({
  result: {
    padding: 26,
    textAlign: 'center',
    backgroundColor: tokens.card,
    borderWidth: 2.5,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketchCard,
    boxShadow: tokens.shadowLg,
  },
  poster: {
    maxWidth: '100%',
    maxHeight: 650,
    objectFit: 'contain',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: 12,
  },
  actions: {
    display: 'flex',
    gap: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    margin: '24px 0 12px',
  },
  actionButton: {
    backgroundColor: tokens.card,
    ':hover:not(:disabled)': {
      backgroundColor: tokens.card,
    },
  },
  scanNote: {
    fontSize: 16,
    color: tokens.muted,
  },
  downloads: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px 18px',
    justifyContent: 'center',
    margin: 12,
  },
})

export default function ResultPanel({
  result,
  artifacts,
  onReturnToEditing,
}: {
  result: Result
  artifacts: Record<string, string>
  onReturnToEditing: () => void
}) {
  return (
    <div {...stylex.props(styles.result)}>
      <img {...stylex.props(styles.poster)} src={artifacts['poster.png']} alt="Assembled artistic QR poster" />
      <div {...stylex.props(styles.actions)}>
        <a {...stylex.props(ui.primary)} href={artifacts['poster.png']} download="poster.png">
          Download poster.png
        </a>
        <button {...stylex.props(ui.button, styles.actionButton)} onClick={onReturnToEditing}>
          Return to editing
        </button>
      </div>
      <p {...stylex.props(styles.scanNote)}>
        Artistic margins can affect scanning. Test the downloaded poster with your phone.
      </p>
      <details {...stylex.props(ui.details)}>
        <summary {...stylex.props(ui.summary)}>Artifacts & verification</summary>
        <div {...stylex.props(styles.downloads)}>
          {Object.keys(result.artifacts)
            .filter((name) => name !== 'poster.png')
            .map((name) => (
              <a key={name} {...stylex.props(ui.textLink)} href={artifacts[name]} download={name}>
                {name}
              </a>
            ))}
        </div>
      </details>
    </div>
  )
}
