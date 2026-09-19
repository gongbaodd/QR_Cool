import type { RegionMask } from './types'
import { grayscaleToPng } from './image'

export function renderRegionMask(mask: RegionMask): Promise<Buffer> {
  return grayscaleToPng(mask.data, mask.width, mask.height)
}
