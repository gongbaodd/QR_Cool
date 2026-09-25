type Point = { x: number; y: number }

const MAX_SUBDIVISION_DEPTH = 12

/** Return a fourth-power superellipse as a compact SVG path. */
export function squirclePath(cx: number, cy: number, radius: number): string {
  if (![cx, cy, radius].every(Number.isFinite) || radius <= 0) {
    throw new RangeError('Squircle center and radius must be finite, with a positive radius.')
  }

  const pointAt = (angle: number): Point => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      x: cx + Math.sign(cos) * Math.sqrt(Math.abs(cos)) * radius,
      y: cy + Math.sign(sin) * Math.sqrt(Math.abs(sin)) * radius,
    }
  }

  const pointLineDistance = (point: Point, start: Point, end: Point): number => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
    const position = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    return Math.hypot(point.x - (start.x + position * dx), point.y - (start.y + position * dy))
  }

  const points: Point[] = [pointAt(0)]
  const tolerance = radius * 0.001
  const subdivide = (startAngle: number, endAngle: number, start: Point, end: Point, depth: number): void => {
    const middleAngle = (startAngle + endAngle) / 2
    const middle = pointAt(middleAngle)
    if (depth >= MAX_SUBDIVISION_DEPTH || pointLineDistance(middle, start, end) <= tolerance) {
      points.push(end)
      return
    }
    subdivide(startAngle, middleAngle, start, middle, depth + 1)
    subdivide(middleAngle, endAngle, middle, end, depth + 1)
  }

  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const startAngle = (quadrant * Math.PI) / 2
    const endAngle = ((quadrant + 1) * Math.PI) / 2
    subdivide(startAngle, endAngle, pointAt(startAngle), pointAt(endAngle), 0)
  }

  const format = (value: number) => Number(value.toFixed(4)).toString()
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${format(point.x)} ${format(point.y)}`)
    .join(' ')
    .concat(' Z')
}
