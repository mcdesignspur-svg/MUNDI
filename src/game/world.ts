import { WALKABLE, type Biome, type Creature, type CreatureKind, type FireCell, type MeteorFx } from './types'

export const WORLD_W = 96
export const WORLD_H = 96
export const TILE = 12

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
  vegetation: Uint8Array
  creatures: Creature[] = []
  fires: FireCell[] = []
  meteors: MeteorFx[] = []
  private nextId = 1
  tick = 0
  population = { human: 0, rabbit: 0, wolf: 0 }

  constructor(seed = Date.now() % 100000) {
    this.tiles = new Array(this.width * this.height)
    this.vegetation = new Uint8Array(this.width * this.height)
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
  }

  generate(seed: number): void {
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
    this.recount()
  }

  spawn(kind: CreatureKind, x: number, y: number): Creature | null {
    if (!this.inBounds(x, y)) return null
    if (!WALKABLE.has(this.get(x, y))) return null
    const c: Creature = {
      id: this.nextId++,
      kind,
      x: x + 0.5,
      y: y + 0.5,
      vx: 0,
      vy: 0,
      life: kind === 'wolf' ? 40 : kind === 'human' ? 50 : 20,
      energy: kind === 'wolf' ? 78 : kind === 'human' ? 82 : 70,
      breedCooldown: 10 + Math.random() * 9,
      age: 0,
    }
    this.creatures.push(c)
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
    this.vegetation[index] -= eaten
    return eaten
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
          this.vegetation[index] = Math.min(100, this.vegetation[index]! + 2)
          continue
        }
        if (biome !== 'sand' || Math.random() > 0.008) continue
        const nearGrass = [
          this.inBounds(x + 1, y) && this.get(x + 1, y) === 'grass',
          this.inBounds(x - 1, y) && this.get(x - 1, y) === 'grass',
          this.inBounds(x, y + 1) && this.get(x, y + 1) === 'grass',
          this.inBounds(x, y - 1) && this.get(x, y - 1) === 'grass',
        ].some(Boolean)
        if (nearGrass) {
          this.tiles[index] = 'grass'
          this.vegetation[index] = 30
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
        if (b === 'forest' || b === 'grass' || b === 'ash') {
          if (!this.fires.some((f) => f.x === x && f.y === y)) {
            this.fires.push({ x, y, heat: 1 })
          }
        }
      }
    }
  }

  rain(cx: number, cy: number, radius = 4): void {
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
    this.recount()
  }

  recount(): void {
    this.population = { human: 0, rabbit: 0, wolf: 0 }
    for (const c of this.creatures) this.population[c.kind]++
  }
}
