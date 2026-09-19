import type { RegionMask } from './types.js'
import { grayscaleToPng } from './image.js'

export function renderRegionMask(mask: RegionMask): Promise<Buffer> {
  return grayscaleToPng(mask.data, mask.width, mask.height)
}
