import type { IconItem } from '../../lib/editor/text-mask'

export default function IconGallery({ query, total, items, selectedIconId, onSelect, onClose }: {
  query: string
  total: number
  items: IconItem[]
  selectedIconId: string | null
  onSelect: (index: number) => void
  onClose: () => void
}) {
  return <div className="mask-preview-wrap mask-gallery-wrap" style={{ border: '2.5px solid var(--ink)', borderRadius: 'var(--sketch-card)', overflow: 'hidden', background: 'var(--card)', boxShadow: 'var(--shadow-lg)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}><h3 style={{ margin:0, fontSize:18 }}>Icons for “{query}” — {total || items.length}</h3><button className="text-button" onClick={onClose}>Back to preview</button></div><div className="gallery-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(72px,1fr))', gap:10, overflow:'auto', maxHeight: 560, padding: 4 }}>{items.map((item, idx) => { const thumb = item.download || item.variants[0]?.download; const selected = selectedIconId === item.id; return <button key={item.id} type="button" aria-label={`Gallery icon ${item.name}`} title={`${item.vendor}/${item.name}`} onClick={() => onSelect(idx)} className={selected ? 'font-card selected' : 'font-card'} style={{ minHeight: 84 }}><span className="font-glyph" style={{ background:'black', borderRadius:6, width:44, height:44, display:'grid', placeItems:'center', color:'white' }}><span aria-hidden="true" style={{ fontSize:20 }}>{(item.name || '?').slice(0,1).toUpperCase()}</span><img src={thumb} alt="" width={28} height={28} style={{ filter:'invert(1)', objectFit:'contain', marginTop:-34 }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} /></span><span className="font-name">{item.name}</span></button> })}{items.length===0 && <p className="hint">No icons to show.</p>}</div></div>
}
