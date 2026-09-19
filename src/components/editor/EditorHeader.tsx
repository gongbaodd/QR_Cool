import Link from 'next/link'
export default function EditorHeader() {
  return (
    <header>
      <Link href="/" className="wordmark">
        QR<span> / </span>COOL
      </Link>
      <span className="header-note">The artistic poster editor</span>
      <span className="local-note">No account. No saved uploads.</span>
    </header>
  )
}
