import { WALKABLE, type Biome } from '../types'

export interface PathGrid {
  width: number
  height: number
  inBounds(x: number, y: number): boolean
  get(x: number, y: number): Biome
  surfaceWaterAt(x: number, y: number): number
  elevationAt(x: number, y: number): number
  fires: { x: number; y: number }[]
}

const DIRS: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
]

/** Movement cost for a tile; Infinity = blocked. Used by A* and path-cost overlays. */
export function movementCost(grid: PathGrid, x: number, y: number): number {
  if (!grid.inBounds(x, y)) return Infinity
  const biome = grid.get(x, y)
  if (!WALKABLE.has(biome)) return Infinity
  if (grid.surfaceWaterAt(x, y) > 55) return Infinity
  let cost = 1
  if (biome === 'mountain') cost = 2.4
  else if (biome === 'forest') cost = 1.45
  else if (biome === 'snow') cost = 1.7
  else if (biome === 'sand') cost = 1.25
  else if (biome === 'ash') cost = 1.35
  const elev = grid.elevationAt(x, y)
  cost += Math.max(0, elev - 55) * 0.018
  for (const fire of grid.fires) {
    const d2 = (fire.x - x) ** 2 + (fire.y - y) ** 2
    if (d2 === 0) return Infinity
    if (d2 < 9) cost += 4
  }
  return cost
}

interface Node {
  x: number
  y: number
  g: number
  f: number
  px: number
  py: number
}

/**
 * Precise A* with 8-directional movement and terrain costs.
 * Reuses scratch buffers to keep tick allocations near zero.
 */
export class Pathfinder {
  private open: Node[] = []
  private came = new Int32Array(0)
  private gScore = new Float32Array(0)
  private closed = new Uint8Array(0)
  private scratchPath: { x: number; y: number }[] = []
  private costField = new Float32Array(0)

  private ensure(width: number, height: number): void {
    const n = width * height
    if (this.came.length !== n) {
      this.came = new Int32Array(n)
      this.gScore = new Float32Array(n)
      this.closed = new Uint8Array(n)
      this.costField = new Float32Array(n)
    }
  }

  /** Fill a cached cost field for debug overlays (O(W·H), call sparingly). */
  rebuildCostField(grid: PathGrid): Float32Array {
    this.ensure(grid.width, grid.height)
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const c = movementCost(grid, x, y)
        this.costField[y * grid.width + x] = Number.isFinite(c) ? Math.min(8, c) : 0
      }
    }
    return this.costField
  }

  pathCostAt(x: number, y: number, width: number): number {
    return this.costField[y * width + x] ?? 0
  }

  findPath(grid: PathGrid, sx: number, sy: number, gx: number, gy: number, maxExpand = 1800): { x: number; y: number }[] | null {
    const startX = Math.floor(sx), startY = Math.floor(sy)
    const goalX = Math.floor(gx), goalY = Math.floor(gy)
    if (!grid.inBounds(startX, startY) || !grid.inBounds(goalX, goalY)) return null
    if (!Number.isFinite(movementCost(grid, goalX, goalY))) return null
    this.ensure(grid.width, grid.height)
    const w = grid.width
    this.came.fill(-1)
    this.gScore.fill(Infinity)
    this.closed.fill(0)
    this.open.length = 0

    const start = startY * w + startX
    this.gScore[start] = 0
    this.open.push({ x: startX, y: startY, g: 0, f: heuristic(startX, startY, goalX, goalY), px: -1, py: -1 })

    let expansions = 0
    while (this.open.length && expansions < maxExpand) {
      expansions++
      let best = 0
      for (let i = 1; i < this.open.length; i++) if (this.open[i]!.f < this.open[best]!.f) best = i
      const current = this.open[best]!
      this.open[best] = this.open[this.open.length - 1]!
      this.open.pop()
      const ci = current.y * w + current.x
      if (this.closed[ci]) continue
      this.closed[ci] = 1
      if (current.x === goalX && current.y === goalY) {
        return this.reconstruct(current.x, current.y, w)
      }
      for (const [dx, dy] of DIRS) {
        const nx = current.x + dx, ny = current.y + dy
        if (!grid.inBounds(nx, ny)) continue
        const ni = ny * w + nx
        if (this.closed[ni]) continue
        const step = movementCost(grid, nx, ny)
        if (!Number.isFinite(step)) continue
        const diagonal = dx !== 0 && dy !== 0 ? 1.414 : 1
        const tentative = current.g + step * diagonal
        if (tentative >= this.gScore[ni]!) continue
        this.gScore[ni] = tentative
        this.came[ni] = ci
        this.open.push({
          x: nx, y: ny, g: tentative,
          f: tentative + heuristic(nx, ny, goalX, goalY),
          px: current.x, py: current.y,
        })
      }
    }
    return null
  }

  private reconstruct(x: number, y: number, w: number): { x: number; y: number }[] {
    this.scratchPath.length = 0
    let cx = x, cy = y
    while (cx >= 0 && cy >= 0) {
      this.scratchPath.push({ x: cx, y: cy })
      const prev = this.came[cy * w + cx]!
      if (prev < 0) break
      cx = prev % w
      cy = (prev / w) | 0
    }
    this.scratchPath.reverse()
    return this.scratchPath.map(p => ({ x: p.x, y: p.y }))
  }
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by)
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)
}

export const sharedPathfinder = new Pathfinder()
