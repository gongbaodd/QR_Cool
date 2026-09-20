/**
 * Engine entry point. `createEditorEngine` is the only way to build an engine:
 * callers inject their environment's `Imaging` implementation (sharp in Node,
 * jSquash + resvg in the browser worker), so no platform leak enters the engine.
 */

import type { Imaging } from '../../../core/imaging/types'
import { EditorEngine } from './engine'
import type { EngineOutcome, PreparedPayload, AssemblePayload, EngineInput, EngineError } from './types'
import type { Placement, Settings } from '../schema'

export type { EditorEngine }
export type { EngineOutcome, PreparedPayload, AssemblePayload, EngineInput, EngineError }
export type { EngineInput as EngineRequest }

export type AssembleInput = EngineInput & {
  placement: Placement
  seed: number
  qrMargin: 1
  plateCorners: Settings['plateCorners']
  rimModules?: number
  rimRounded?: boolean
  ecc?: Settings['ecc']
  pixelStyle?: Settings['pixelStyle']
  markerStyle?: Settings['markerStyle']
  markerShape?: Settings['markerShape']
  markerInner?: Settings['markerInner']
  markerSub?: Settings['markerSub']
}

/** The Comlink-exposed surface: every call goes through {@link EngineOutcome}. */
export interface EditorEngineApi {
  prepare: (input: EngineInput, revision: number) => Promise<EngineOutcome<PreparedPayload>>
  assemble: (input: AssembleInput, revision: number) => Promise<EngineOutcome<AssemblePayload>>
  invalidate: () => void
}

export async function createEditorEngine(imaging: Imaging): Promise<EditorEngineApi> {
  const engine = new EditorEngine(imaging)
  return {
    prepare: (input, revision) => engine.prepare(input, revision),
    assemble: (input, revision) => engine.assemble(input, revision),
    invalidate: () => engine.invalidate(),
  }
}
