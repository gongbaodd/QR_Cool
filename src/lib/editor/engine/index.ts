/**
 * Engine entry point. `createEditorEngine` is the only way to build an engine:
 * callers inject their environment's `Imaging` implementation (sharp in Node,
 * jSquash + resvg in the browser worker), so no platform leak enters the engine.
 */

import type { Imaging } from '@/core/imaging/types'
import { EditorEngine } from './engine'
import type {
  EngineOutcome,
  PreparedPayload,
  AssemblePayload,
  RasterExportPayload,
  EngineInput,
  EngineError,
} from './types'
import type { Placement, Settings } from '@/lib/editor/schema'

export type { EditorEngine }
export type { EngineOutcome, PreparedPayload, AssemblePayload, RasterExportPayload, EngineInput, EngineError }
export type { EngineInput as EngineRequest }

export type AssembleInput = EngineInput & {
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
  colors?: Settings['colors']
}

/** The Comlink-exposed surface: every call goes through {@link EngineOutcome}. */
export interface EditorEngineApi {
  prepare: (input: EngineInput, revision: number) => Promise<EngineOutcome<PreparedPayload>>
  assemble: (input: AssembleInput, revision: number) => Promise<EngineOutcome<AssemblePayload>>
  exportRaster: (
    input: AssembleInput,
    targetPitch: number,
    revision: number,
  ) => Promise<EngineOutcome<RasterExportPayload>>
  invalidate: () => void
}

export async function createEditorEngine(imaging: Imaging): Promise<EditorEngineApi> {
  const engine = new EditorEngine(imaging)
  return {
    prepare: (input, revision) => engine.prepare(input, revision),
    assemble: (input, revision) => engine.assemble(input, revision),
    exportRaster: (input, targetPitch, revision) => engine.exportRaster(input, targetPitch, revision),
    invalidate: () => engine.invalidate(),
  }
}
