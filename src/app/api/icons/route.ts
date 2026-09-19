export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length === 0) {
    return Response.json({ total: 0, count: 0, limit: 100, offset: 0, items: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (q.length > 10) {
    return Response.json({ message: 'Query too long.', code: 400 }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const upstream = await fetch(`https://icons.grida.co/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) })
    if (!upstream.ok) {
      return Response.json({ total: 0, count: 0, limit: 100, offset: 0, items: [], upstreamStatus: upstream.status }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const data = await upstream.json()
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ total: 0, count: 0, limit: 100, offset: 0, items: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
