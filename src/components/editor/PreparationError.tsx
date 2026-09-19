export default function PreparationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error" role="alert">
      {message}
      <button onClick={onRetry}>Retry preparation</button>
    </div>
  )
}
