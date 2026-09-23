import type { Metadata, Viewport } from 'next'
import * as stylex from '@stylexjs/stylex'
import { ui } from '@/styles/ui.stylex'
import './globals.css'
export const metadata: Metadata = {
  title: 'mahu-QR — Artistic poster editor',
  description: 'Turn a black region in your poster into a deterministic artistic QR texture.',
}
export const viewport: Viewport = {
  // Mirrors `tokens.paper` (`#fdf8f2`); tokens are CSS custom properties, not
  // literals, so the value is repeated here for the browser chrome.
  themeColor: '#fdf8f2',
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body {...stylex.props(ui.body)}>{children}</body>
    </html>
  )
}
