import { FLAMMABLE, MAX_AGENTS, MAX_HEALTH, WALKABLE, type Biome, type Creature, type CreatureKind, type FireCell, type MeteorFx } from './types'
import { Random, seedNumber } from './random'
import { SpatialIndex } from './spatial'

export const WORLD_W = 96
export const WORLD_H = 96
export const TILE = 16
export const CHUNK = 16
export const MAX_FIRES = 180

function hash(x: number, y: number, seed: number): number {
  let n = x * 374761393 + y * 668265263 + seed * 982451653
  n = (n ^ (n >>> 13)) * 1274126177
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(x0, y0, seed)
  const b = hash(x0 + 1, y0, seed)
  const c = hash(x0, y0 + 1, seed)
  const d = hash(x0 + 1, y0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function fbm(x: number, y: number, seed: number): number {
  let v = 0
  let a = 0.5
  let f = 1
  for (let i = 0; i < 4; i++) {
    v += noise2(x * f, y * f, seed + i * 17) * a
    a *= 0.5
    f *= 2
  }
  return v
}

export class World {
  readonly width = WORLD_W
  readonly height = WORLD_H
  tiles: Biome[]
  vegetation: Float32Array
  seed = ''
  random = new Random(1)
  spatial = new SpatialIndex()
  revision = 0
  terrainVersions = new Uint32Array(36)
  rainEffects: { x: number; y: number; age: number; radius: number }[] = []
  creatures: Creature[] = []
  fires: FireCell[] = []
  meteors: MeteorFx[] = []
  nextId = 1
  tick = 0
  population = { human: 0, rabbit: 0, wolf: 0 }

  constructor(seed: string | number = 'MUNDI-ALBOR') {
    this.tiles = new Array(this.width * this.height)
    this.vegetation = new Float32Array(this.width * this.height)
    this.generate(seed)
  }

  index(x: number, y: number): number {
    return y * this.width + x
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  get(x: number, y: number): Biome {
    return this.tiles[this.index(x, y)]!
  }

  set(x: number, y: number, biome: Biome): void {
    if (!this.inBounds(x, y)) return
    this.tiles[this.index(x, y)] = biome
    this.vegetation[this.index(x, y)] = biome === 'forest' ? 100 : biome === 'grass' ? 65 : 0
    this.touch(x, y)
  }

  touch(x: number, y: number): void {
    this.revision++
    // Invalidate neighbors too: coastline edges depend on adjacent tiles.
    for (let cy = Math.max(0, Math.floor((y - 1) / CHUNK)); cy <= Math.min(5, Math.floor((y + 1) / CHUNK)); cy++) {
      for (let cx = Math.max(0, Math.floor((x - 1) / CHUNK)); cx <= Math.min(5, Math.floor((x + 1) / CHUNK)); cx++) this.terrainVersions[cy * 6 + cx]++
    }
  }

  generate(seedInput: string | number): void {
    this.seed = String(seedInput)
    const seed = seedNumber(this.seed)
    this.random = new Random(seed)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x / this.width
        const ny = y / this.height
        const elev = fbm(nx * 4.2, ny * 4.2, seed)
        const moist = fbm(nx * 5.1 + 40, ny * 5.1 + 40, seed + 99)
        const dist =
          Math.hypot(nx - 0.5, ny - 0.5) * 1.35 +
          (fbm(nx * 3, ny * 3, seed + 7) - 0.5) * 0.15

        let biome: Biome
        if (dist > 0.62 || elev < 0.32) {
          biome = elev < 0.28 ? 'deepWater' : 'water'
        } else if (elev < 0.38) {
          biome = 'sand'
        } else if (elev > 0.72) {
          biome = moist > 0.55 ? 'snow' : 'mountain'
        } else if (moist > 0.58 && elev > 0.42) {
          biome = 'forest'
        } else {
          biome = 'grass'
        }
        const index = this.index(x, y)
        this.tiles[index] = biome
        this.vegetation[index] = biome === 'forest' ? 100 : biome === 'grass' ? 55 + ((elev * 40) | 0) : 0
      }
    }
    this.creatures = []
    this.fires = []
    this.meteors = []
    this.nextId = 1
    this.tick = 0
    this.rainEffects = []
    this.revision++
    for (let i = 0; i < 36; i++) this.terrainVersions[i]++
    this.recount()
  }

  populate(): void {
    const center = { x: 48, y: 48 }
    const grass: { x: number; y: number }[] = []
    for (let y = 8; y < this.height - 8; y++) for (let x = 8; x < this.width - 8; x++) {
      if (this.get(x, y) === 'grass') grass.push({ x, y })
    }
    grass.sort((a, b) => ((a.x - center.x) ** 2 + (a.y - center.y) ** 2) - ((b.x - center.x) ** 2 + (b.y - center.y) ** 2))
    const candidates = grass.slice(0, Math.max(100, Math.floor(grass.length * 0.35)))
    for (const [kind, count] of [['human', 8], ['rabbit', 28], ['wolf', 4]] as const) {
      for (let i = 0; i < count && candidates.length; i++) {
        const p = candidates[Math.floor(this.random.next() * candidates.length)]!
        const c = this.spawn(kind, p.x, p.y)
        if (c) c.age = 10 + this.random.next() * 15
      }
    }
    this.spatial.rebuild(this.creatures)
  }

  spawn(kind: CreatureKind, x: number, y: number): Creature | null {
    if (this.creatures.length >= MAX_AGENTS) return null
    if (!this.inBounds(x, y)) return null
    if (!WALKABLE.has(this.get(x, y))) return null
    const heading = this.random.next() * Math.PI * 2
    const c: Creature = {
      id: this.nextId++,
      kind,
      x: x + 0.5,
      y: y + 0.5,
      vx: Math.cos(heading),
      vy: Math.sin(heading),
      life: MAX_HEALTH[kind],
      energy: kind === 'wolf' ? 78 : kind === 'human' ? 82 : 70,
      // A starter population should settle before it starts growing. Rabbits
      // receive a longer first cooldown; newborns are also protected by age.
      breedCooldown: kind === 'rabbit' ? 45 + this.random.next() * 60 : 10 + this.random.next() * 9,
      age: 0,
      activity: 'exploring',
      // Freshly created beings set off right away instead of waiting for the
      // first decision cycle, which makes a new world feel immediately alive.
      decisionIn: 0.15 + this.random.next() * 0.35,
    }
    this.creatures.push(c)
    this.revision++
    this.recount()
    return c
  }

  paintBrush(cx: number, cy: number, biome: Biome, radius: number): void {
    const r2 = radius * radius
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.inBounds(x, y)) continue
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy <= r2) {
          this.set(x, y, biome)
          this.vegetation[this.index(x, y)] = biome === 'forest' ? 100 : biome === 'grass' ? 75 : 0
        }
      }
    }
  }

  vegetationAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0
    return this.vegetation[this.index(x, y)]
  }

  graze(x: number, y: number, amount: number): number {
    if (!this.inBounds(x, y) || this.get(x, y) !== 'grass') return 0
    const index = this.index(x, y)
    const eaten = Math.min(amount, this.vegetation[index]!)
    const previous = this.vegetation[index]!
    this.vegetation[index] -= eaten
    if (eaten > 0) {
      this.revision++
      if (Math.floor(previous / 20) !== Math.floor(this.vegetation[index]! / 20)) this.touch(x, y)
    }
    return eaten
  }

  /** Consume plant fuel without changing the geography until the fire is done. */
  burnFuel(x: number, y: number, amount: number): number {
    if (!this.inBounds(x, y) || !FLAMMABLE.has(this.get(x, y))) return 0
    const index = this.index(x, y)
    const previous = this.vegetation[index]!
    const remaining = Math.max(0, previous - amount)
    this.vegetation[index] = remaining
    if (remaining !== previous) {
      this.revision++
      if (Math.floor(previous / 20) !== Math.floor(remaining / 20)) this.touch(x, y)
    }
    return remaining
  }

  nearestFood(cx: number, cy: number, radius: number): { x: number; y: number } | null {
    const minX = Math.max(0, Math.floor(cx - radius))
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius))
    const minY = Math.max(0, Math.floor(cy - radius))
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius))
    let best: { x: number; y: number } | null = null
    let bestDistance = Infinity
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (this.get(x, y) !== 'grass' || this.vegetationAt(x, y) < 15) continue
        const distance = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
        if (distance < bestDistance) {
          bestDistance = distance
          best = { x, y }
        }
      }
    }
    return best
  }

  regrowNature(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const index = this.index(x, y)
        const biome = this.tiles[index]!
        if (biome === 'grass') {
          const previous = this.vegetation[index]!
          this.vegetation[index] = Math.min(100, previous + 2)
          if (Math.floor(previous / 20) !== Math.floor(this.vegetation[index]! / 20)) this.touch(x, y)
          continue
        }
        if (biome !== 'sand' || this.random.next() > 0.008) continue
        const nearGrass = [
          this.inBounds(x + 1, y) && this.get(x + 1, y) === 'grass',
          this.inBounds(x - 1, y) && this.get(x - 1, y) === 'grass',
          this.inBounds(x, y + 1) && this.get(x, y + 1) === 'grass',
          this.inBounds(x, y - 1) && this.get(x, y - 1) === 'grass',
        ].some(Boolean)
        if (nearGrass) {
          this.tiles[index] = 'grass'
          this.vegetation[index] = 30
          this.touch(x, y)
        }
      }
    }
  }

  vegetationLevel(): number {
    let total = 0
    let count = 0
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] !== 'grass') continue
      total += this.vegetation[i]!
      count++
    }
    return count === 0 ? 0 : Math.round(total / count)
  }

  ignite(cx: number, cy: number, radius = 1): void {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.inBounds(x, y)) continue
        const b = this.get(x, y)
        if (b === 'forest' || b === 'grass') {
          if (!this.fires.some((f) => f.x === x && f.y === y)) {
            if (this.fires.length >= MAX_FIRES) return
            this.fires.push({ x, y, heat: 1 })
            this.revision++
          }
        }
      }
    }
  }

  rain(cx: number, cy: number, radius = 4): void {
    this.rainEffects.push({ x: cx, y: cy, radius, age: 0 })
    if (this.rainEffects.length > 12) this.rainEffects.shift()
    this.revision++
    const r2 = radius * radius
    this.fires = this.fires.filter((f) => {
      const dx = f.x - cx
      const dy = f.y - cy
      return dx * dx + dy * dy > r2
    })
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.inBounds(x, y)) continue
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy > r2) continue
        const b = this.get(x, y)
        if (b === 'lava') this.set(x, y, 'ash')
        if (b === 'ash') this.set(x, y, 'grass')
      }
    }
  }

  meteor(cx: number, cy: number): void {
    const radius = 3
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.inBounds(x, y)) continue
        const dx = x - cx
        const dy = y - cy
        const d2 = dx * dx + dy * dy
        if (d2 > radius * radius) continue
        if (d2 <= 1) this.set(x, y, 'lava')
        else if (d2 <= 4) this.set(x, y, 'ash')
        else {
          const b = this.get(x, y)
          if (b !== 'deepWater' && b !== 'water') this.set(x, y, 'ash')
        }
      }
    }
    this.creatures = this.creatures.filter((c) => {
      const dx = c.x - cx - 0.5
      const dy = c.y - cy - 0.5
      return dx * dx + dy * dy > 9
    })
    this.ignite(cx, cy, 5)
    this.meteors.push({ x: cx + 0.5, y: cy + 0.5, age: 0, radius: 18 })
    if (this.meteors.length > 64) this.meteors.shift()
    this.recount()
  }

  recount(): void {
    this.population = { human: 0, rabbit: 0, wolf: 0 }
    for (const c of this.creatures) this.population[c.kind]++
  }
}
