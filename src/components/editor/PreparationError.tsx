import * as stylex from '@stylexjs/stylex'
import { ui } from '../../styles/ui.stylex'

export default function PreparationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div {...stylex.props(ui.error)} role="alert">
      {message}
      <button {...stylex.props(ui.button, ui.errorButton)} onClick={onRetry}>
        Retry preparation
      </button>
    </div>
  )
}
