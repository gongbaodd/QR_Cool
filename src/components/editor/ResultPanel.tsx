'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { toast } from 'react-toastify'
import { rasterExportChoices } from '@/core/export-sizes'
import type { RasterExportPayload } from '@/lib/editor/engine'
import type { Result } from '@/lib/editor/state'
import type { Placement } from '@/lib/editor/schema'
import { tokens } from '@/styles/tokens.stylex'
import { ui } from '@/styles/ui.stylex'
import { useBlobUrls } from './hooks/use-blob-urls'

type ResolvedRasterChoice = Pick<RasterExportPayload, 'width' | 'height' | 'bytes'>

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
    display: 'block',
    maxWidth: '100%',
    maxHeight: 650,
    objectFit: 'contain',
    borderRadius: 10,
  },
  posterFrame: {
    display: 'inline-block',
    maxWidth: '100%',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    backgroundImage:
      'linear-gradient(45deg, #e7e4e7 25%, transparent 25%, transparent 75%, #e7e4e7 75%), linear-gradient(45deg, #e7e4e7 25%, transparent 25%, transparent 75%, #e7e4e7 75%)',
    backgroundPosition: '0 0, 8px 8px',
    backgroundSize: '16px 16px',
  },
  actions: {
    display: 'flex',
    gap: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    margin: '24px 0 12px',
  },
  exportControls: {
    display: 'flex',
    alignItems: 'end',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 20,
  },
  sizeField: { display: 'grid', gap: 4, textAlign: 'start' },
  sizeLabel: { fontSize: '0.875rem', color: tokens.inkMuted },
  sizeSelect: {
    minHeight: 44,
    maxWidth: '100%',
    paddingBlock: 8,
    paddingInline: 12,
    font: 'inherit',
    color: tokens.ink,
    backgroundColor: tokens.card,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: tokens.ink,
    borderRadius: tokens.sketch,
  },
  actionButton: {
    backgroundColor: tokens.card,
    ':hover:not(:disabled)': {
      backgroundColor: tokens.card,
    },
  },
  scanNote: {
    fontSize: '1rem',
    color: tokens.inkMuted,
  },
  exportStatus: { margin: '8px 0 0', color: tokens.inkMuted, fontSize: '0.875rem' },
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
  dimensions,
  placement,
  modules,
  onExportRaster,
  onReturnToEditing,
}: {
  result: Result
  artifacts: Record<string, string>
  dimensions: { width: number; height: number }
  placement: Placement
  modules: number
  onExportRaster: (targetPitch: number) => Promise<RasterExportPayload>
  onReturnToEditing: () => void
}) {
  const originalPitch = placement.size / modules
  const choices = useMemo(
    () => rasterExportChoices(dimensions.width, dimensions.height, originalPitch),
    [dimensions.height, dimensions.width, originalPitch],
  )
  const [selectedKey, setSelectedKey] = useState('original')
  const [variant, setVariant] = useState<(RasterExportPayload & { key: string }) | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [resolvedChoices, setResolvedChoices] = useState<Record<string, ResolvedRasterChoice>>({})
  const [minimumStatus, setMinimumStatus] = useState<'calculating' | 'ready' | 'original'>('calculating')
  const generation = useRef(0)
  const variantName = variant ? `poster-${variant.width}x${variant.height}.png` : ''
  const variantUrls = useBlobUrls(variant ? { [variantName]: variant.poster } : {})
  const variantUrl = variant ? variantUrls[variantName] : undefined
  const showingVariant = !!variant && !!variantUrl && selectedKey === variant.key
  const posterUrl = showingVariant ? variantUrl : artifacts['poster.png']
  const pngName = showingVariant ? variantName : 'poster.png'
  const pngSize = showingVariant ? variant.bytes : result.artifacts['poster.png']?.size
  const svgSize = result.artifacts['poster.svg']?.size

  useEffect(() => {
    const minimum = choices[0]
    if (!minimum) {
      setMinimumStatus('original')
      return
    }
    const token = ++generation.current
    let live = true
    setMinimumStatus('calculating')
    void onExportRaster(minimum.targetPitch)
      .then((exported) => {
        if (!live || token !== generation.current) return
        setVariant({ ...exported, key: minimum.key })
        setResolvedChoices({ [minimum.key]: rasterMetadata(exported) })
        setMinimumStatus('ready')
      })
      .catch(() => {
        if (!live || token !== generation.current) return
        setMinimumStatus('original')
      })
    return () => {
      live = false
      generation.current += 1
    }
  }, [choices, onExportRaster])

  async function selectSize(key: string) {
    if (key === 'original') {
      generation.current += 1
      setSelectedKey('original')
      setPendingKey(null)
      return
    }
    const choice = choices.find((entry) => entry.key === key)
    if (!choice) return
    if (variant?.key === key) {
      setSelectedKey(key)
      setPendingKey(null)
      return
    }
    const token = ++generation.current
    setPendingKey(key)
    try {
      const exported = await onExportRaster(choice.targetPitch)
      if (token !== generation.current) return
      setVariant({ ...exported, key })
      setResolvedChoices((current) => ({ ...current, [key]: rasterMetadata(exported) }))
      setSelectedKey(key)
      setPendingKey(null)
      toast.success(`Raster export ready at ${exported.width} × ${exported.height}px.`, {
        toastId: 'raster-export-ready',
        autoClose: 3500,
        role: 'status',
      })
    } catch (error) {
      if (token !== generation.current) return
      setPendingKey(null)
      toast.error(error instanceof Error ? error.message : 'Could not render that poster size.', {
        toastId: 'raster-export-error',
        autoClose: false,
        role: 'alert',
      })
    }
  }

  return (
    <div {...stylex.props(styles.result)}>
      <div {...stylex.props(styles.posterFrame)}>
        <img
          {...stylex.props(styles.poster)}
          src={posterUrl}
          width={showingVariant ? variant.width : dimensions.width}
          height={showingVariant ? variant.height : dimensions.height}
          alt="Assembled artistic QR poster"
        />
      </div>
      <div {...stylex.props(styles.exportControls)}>
        <label {...stylex.props(styles.sizeField)}>
          <span {...stylex.props(styles.sizeLabel)}>PNG size</span>
          <select
            {...stylex.props(styles.sizeSelect, ui.focusVisible)}
            value={pendingKey ?? selectedKey}
            onChange={(event) => void selectSize(event.target.value)}
          >
            <option value="original">
              {dimensions.width} × {dimensions.height} px · {formatBytes(result.artifacts['poster.png']?.size ?? 0)}
            </option>
            {minimumStatus !== 'original' &&
              choices.map((choice) => {
                const resolved = resolvedChoices[choice.key]
                return (
                  <option key={choice.key} value={choice.key}>
                    {resolved?.width ?? choice.width} × {resolved?.height ?? choice.height} px
                    {resolved ? ` · ${formatBytes(resolved.bytes)}` : ''}
                  </option>
                )
              })}
          </select>
        </label>
      </div>
      <div {...stylex.props(styles.actions)}>
        <a {...stylex.props(ui.primary, ui.focusVisible)} href={posterUrl} download={pngName}>
          Download PNG{pngSize ? ` · ${formatBytes(pngSize)}` : ''}
        </a>
        <a
          {...stylex.props(ui.button, ui.focusVisible, styles.actionButton)}
          href={artifacts['poster.svg']}
          download="poster.svg"
        >
          Download SVG{svgSize ? ` · ${formatBytes(svgSize)}` : ''}
        </a>
        <button {...stylex.props(ui.button, ui.focusVisible, styles.actionButton)} onClick={onReturnToEditing}>
          Return to editing
        </button>
      </div>
      {pendingKey && (
        <p {...stylex.props(styles.exportStatus)} role="status" aria-live="polite">
          Rendering…
        </p>
      )}
      <p {...stylex.props(styles.scanNote)}>
        Artistic margins can affect scanning. Test the downloaded poster with your phone.
      </p>
      <details {...stylex.props(ui.details)}>
        <summary {...stylex.props(ui.summary, ui.focusVisible)}>Artifacts & verification</summary>
        <div {...stylex.props(styles.downloads)}>
          {Object.keys(result.artifacts)
            .filter((name) => name !== 'poster.png' && name !== 'poster.svg')
            .map((name) => (
              <a key={name} {...stylex.props(ui.textLink, ui.focusVisible)} href={artifacts[name]} download={name}>
                {name}
              </a>
            ))}
        </div>
      </details>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function rasterMetadata(exported: RasterExportPayload): ResolvedRasterChoice {
  return {
    width: exported.width,
    height: exported.height,
    bytes: exported.bytes,
  }
}
