import type { RegionMask } from './types'
import { grayscaleToPng } from './image'

export function renderRegionMask(mask: RegionMask): Promise<Uint8Array> {
  return grayscaleToPng(mask.data, mask.width, mask.height)
}
