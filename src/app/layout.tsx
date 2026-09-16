import type { Metadata } from 'next'
import './globals.css'
export const metadata: Metadata = { title: 'QR / COOL — Artistic poster editor', description: 'Turn a black region in your poster into a deterministic artistic QR texture.' }
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html> }
