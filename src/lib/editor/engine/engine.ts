/**
 * The editor engine: prepares and assembles posters with session state kept in
 * memory, so an edit only re-runs what changed. Runs identically in Node
 * (tests/scripts, sharp-backed imaging) and inside the browser worker (browser
 * imaging) — it depends on neither platform.
 *
 * - Source cache: decoded poster and derived region keyed by the file sha256
 *   identity; a placement/seed/settings edit re-runs geometry only, a
 *   content/ecc/style edit regenerates the QR only, a new file re-decodes.
 * - Stale suppression: latest-revision-wins. When a newer revision arrives
 *   while an older one is still in flight, the older one's settled result is
 *   dropped at the outcome boundary — no cancellation machinery is added
 *   around codecs or detectors.
 */

import type { Imaging } from '@/core/imaging/types'
import type { LoadedPng } from '@/core/image'
import type { RegionMask, ResolvedLayout } from '@/core/types'
import { setImaging } from '@/core/imaging'
import type { QrBundle } from './pipeline'
import {
  engineDefaults,
  prepareSource,
  resolveQr,
  applyPlacement,
  toPreparedPayload,
  assemblePayload,
  normalizeQr,
} from './pipeline'
import { toEngineError } from './mapping'
import type { EngineError, EngineInput, EngineOutcome, PreparedPayload, AssemblePayload } from './types'
import type { Placement, Settings } from '@/lib/editor/schema'

/** Assembled layout shared by prepare and assemble. */
interface EngineSourcedLayout {
  layout: ResolvedLayout
  validation: string | null
}

/** Bounded source cache: at most this many posters stay alive per session. */
const MAX_SOURCE_ENTRIES = 4

interface SourceEntry {
  poster: LoadedPng
  /** Region variants derived per mask file, keyed by the mask file sha256 ('' = auto detection). */
  regions: Map<string, { mask: RegionMask; maskInput?: LoadedPng }>
}

const AUTO_REGION_KEY = ''

/** The QR-shaping settings — the only settings that invalidate the generated QR bundle. */
function qrCacheKey(input: Pick<EngineInput, 'content' | 'settings'>): string {
  const s = input.settings ?? {}
  return [
    input.content,
    s.ecc ?? engineDefaults.ecc,
    s.pixelStyle ?? engineDefaults.pixelStyle,
    JSON.stringify(s.finderMarkers ?? engineDefaults.finderMarkers),
    s.markerSub ?? engineDefaults.markerSub,
  ].join('\u0000')
}

export class EditorEngine {
  private imaging: Imaging
  private sources = new Map<string, SourceEntry>()
  private qrBundles = new Map<string, Promise<QrBundle>>()
  private latestRevision = 0

  constructor(imaging: Imaging) {
    // Core modules resolve the backend through the seam singleton; installing it
    // here is the same injection point the parity harness and worker use.
    setImaging(imaging)
    this.imaging = imaging
  }

  /** Frees every cached source/QR bundle. */
  invalidate(): void {
    this.sources.clear()
    this.qrBundles.clear()
    this.latestRevision = 0
  }

  /** Step-2 payload for the current editor state. */
  async prepare(input: EngineInput, revision: number): Promise<EngineOutcome<PreparedPayload>> {
    if (revision > this.latestRevision) this.latestRevision = revision
    try {
      const resolved = await this.resolveLayout(input)
      const value = await toPreparedPayload(this.imaging, resolved.layout, resolved.validation)
      return this.settle(revision, { ok: true, value })
    } catch (error) {
      return this.settle(revision, { ok: false, error: toEngineError(error) })
    }
  }

  /** Step-4 payload: the schema-8 report plus Blob artifacts. */
  async assemble(
    input: EngineInput & {
      placement: Placement
      seed: number
      qrMargin: 1
      plateCorners: Settings['plateCorners']
      regionMargin?: boolean
      rimModules?: number
      rimRounded?: boolean
      ecc?: Settings['ecc']
      pixelStyle?: Settings['pixelStyle']
      finderMarkers?: Settings['finderMarkers']
      markerSub?: Settings['markerSub']
    },
    revision: number,
  ): Promise<EngineOutcome<AssemblePayload>> {
    if (revision > this.latestRevision) this.latestRevision = revision
    try {
      const value = await assemblePayload(this.imaging, input)
      return this.settle(revision, { ok: true, value })
    } catch (error) {
      return this.settle(revision, { ok: false, error: toEngineError(error) })
    }
  }

  /** The settle-time revision check is the only stale gate: superseded runs drop here. */
  private settle<T>(
    revision: number,
    result: { ok: true; value: T } | { ok: false; error: EngineError },
  ): EngineOutcome<T> {
    if (revision < this.latestRevision) return { ok: false, stale: true, revision }
    return { ...result, revision }
  }

  /** Shared prepare/assemble resolution with the source and QR caches applied. */
  private async resolveLayout(input: EngineInput): Promise<EngineSourcedLayout> {
    const { source } = await this.cachedSource(input.posterBytes, input.maskBytes)
    const qr = await this.cachedQr(input)
    const settings = { ...engineDefaults, ...input.settings }
    const applied = applyPlacement({ source, qr, input, settings })
    if (!applied.validation) applied.layout.normalizedQr = await normalizeQr(qr.qrSource, applied.layout.placement.size)
    return applied
  }

  /** Poster decode + region detection, keyed by content identity (sha256). */
  private async cachedSource(
    posterBytes: Uint8Array,
    maskBytes?: Uint8Array,
  ): Promise<{
    source: { poster: LoadedPng; maskInput?: LoadedPng; regionMask: RegionMask }
    posterBytes: Uint8Array
  }> {
    const posterSha = await this.imaging.sha256Hex(posterBytes)
    const regionKey = maskBytes ? await this.imaging.sha256Hex(maskBytes) : AUTO_REGION_KEY
    let entry = this.sources.get(posterSha)
    if (!entry) {
      // First touch: decode with the mask included so region and maskInput fill together.
      const fresh = await prepareSource(this.imaging, posterBytes, maskBytes)
      entry = {
        poster: fresh.poster,
        regions: new Map([
          [
            regionKey,
            {
              mask: fresh.regionMask,
              ...(fresh.maskInput ? { maskInput: fresh.maskInput } : {}),
            },
          ],
        ]),
      }
      this.sources.set(posterSha, entry)
      this.evictSources()
      return {
        posterBytes,
        source: {
          poster: fresh.poster,
          ...(fresh.maskInput ? { maskInput: fresh.maskInput } : {}),
          regionMask: fresh.regionMask,
        },
      }
    }
    let region = entry.regions.get(regionKey)
    if (!region) {
      const fresh = await prepareSource(this.imaging, posterBytes, maskBytes)
      region = {
        mask: fresh.regionMask,
        ...(fresh.maskInput ? { maskInput: fresh.maskInput } : {}),
      }
      entry.regions.set(regionKey, region)
    }
    return {
      posterBytes,
      source: {
        poster: entry.poster,
        ...(region.maskInput ? { maskInput: region.maskInput } : {}),
        regionMask: region.mask,
      },
    }
  }

  private evictSources(): void {
    while (this.sources.size > MAX_SOURCE_ENTRIES) {
      const oldest = this.sources.keys().next().value
      if (oldest === undefined) break
      this.sources.delete(oldest)
    }
  }

  /** Generated QR bundle keyed by the content and the QR-shaping settings. */
  private async cachedQr(input: EngineInput): Promise<QrBundle> {
    const key = qrCacheKey(input)
    // Await any same-key generation already running instead of decoding twice.
    const cached = this.qrBundles.get(key) ?? resolveQr(this.imaging, input)
    this.qrBundles.set(key, cached)
    try {
      return await cached
    } catch (error) {
      this.qrBundles.delete(key)
      throw error
    }
  }
}
