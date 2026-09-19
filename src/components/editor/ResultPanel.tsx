import type { Result } from '../../lib/editor/state'

export default function ResultPanel({ result, artifacts, onReturnToEditing }: {
  result: Result
  artifacts: Record<string, string>
  onReturnToEditing: () => void
}) {
  return <div className="result"><img src={artifacts['poster.png']} alt="Assembled artistic QR poster" /><div className="result-actions"><a className="primary" href={artifacts['poster.png']} download="poster.png">Download poster.png</a><button onClick={onReturnToEditing}>Return to editing</button></div><p className="scan-note">Artistic margins can affect scanning. Test the downloaded poster with your phone.</p><details><summary>Artifacts & verification</summary><div className="downloads">{Object.keys(result.artifacts).filter(name => name !== 'poster.png').map(name => <a key={name} href={artifacts[name]} download={name}>{name}</a>)}</div></details></div>
}
