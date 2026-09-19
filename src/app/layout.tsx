import type { Metadata } from 'next'
import * as stylex from '@stylexjs/stylex'
import { ui } from '../styles/ui.stylex'
import './globals.css'
export const metadata: Metadata = {
  title: 'QR / COOL — Artistic poster editor',
  description: 'Turn a black region in your poster into a deterministic artistic QR texture.',
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body {...stylex.props(ui.body)}>{children}</body>
    </html>
  )
}
