import { FLAMMABLE, MAX_AGENTS, MAX_AGE, MAX_HEALTH, WALKABLE, emptyProgress, type Biome, type Building, type Creature, type CreatureKind, type DayPhase, type DeathCause, type DeathRecord, type FireCell, type HumanTask, type MeteorFx, type PopulationSample, type Season, type Village, type Weather, type WorldEvent, type WorldEventKind } from './types'
import { evaluateKnowledge, evaluateTech, foodUpkeep, hasTech, techAllowsBuilding } from './progression'
import { Random, seedNumber } from './random'
import { SpatialIndex } from './spatial'
import { engine } from './core/engine'
import { MAX_VILLAGES, MIN_FOUND_DISTANCE, VILLAGE_STYLES, ensureRelation } from './systems/faction'

export const WORLD_W = 96
export const WORLD_H = 96
export const TILE = 16
export const CHUNK = 16
export const MAX_FIRES = 180
/** Minutes of world-time that make one full day/night cycle. */
export const DAY_LENGTH = 24

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
  moisture: Float32Array
  fertility: Float32Array
  /** Normalized height 0–100 used by runoff and biome succession. */
  elevation: Float32Array
  /** Local air temperature in °C-like units (−20…45). */
  temperature: Float32Array
  /** Transient surface water from storms and runoff (0–100). */
  surfaceWater: Float32Array
  /** Double-buffer for hydrology to avoid per-tick Float32Array allocations. */
  private surfaceWaterNext: Float32Array
  seed = ''
  random = new Random(1)
  spatial = new SpatialIndex()
  revision = 0
  terrainVersions = new Uint32Array(36)
  rainEffects: { x: number; y: number; age: number; radius: number }[] = []
  creatures: Creature[] = []
  villages: Village[] = []
  buildings: Building[] = []
  deaths: DeathRecord[] = []
  events: WorldEvent[] = []
  populationHistory: PopulationSample[] = []
  fires: FireCell[] = []
  meteors: MeteorFx[] = []
  nextId = 1
  nextVillageId = 1
  tick = 0
  weather: Weather = 'clear'
  weatherUntil = 0
  /** Wind direction in radians; fire and storms bias along this axis. */
  windAngle = 0
  windStrength = 0.35
  population = { human: 0, rabbit: 0, wolf: 0 }
  static readonly MAX_VILLAGES = MAX_VILLAGES
  static readonly MIN_FOUND_DISTANCE = MIN_FOUND_DISTANCE

  constructor(seed: string | number = 'MUNDI-ALBOR') {
    this.tiles = new Array(this.width * this.height)
    this.vegetation = new Float32Array(this.width * this.height)
    this.moisture = new Float32Array(this.width * this.height)
    this.fertility = new Float32Array(this.width * this.height)
    this.elevation = new Float32Array(this.width * this.height)
    this.temperature = new Float32Array(this.width * this.height)
    this.surfaceWater = new Float32Array(this.width * this.height)
    this.surfaceWaterNext = new Float32Array(this.width * this.height)
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
    const index = this.index(x, y)
    this.vegetation[index] = biome === 'forest' ? 100 : biome === 'grass' ? 65 : 0
    if (biome === 'water' || biome === 'deepWater') {
      this.moisture[index] = 100
      this.surfaceWater[index] = 0
    } else if (biome === 'ash' || biome === 'lava') this.fertility[index] = Math.max(8, this.fertility[index]! * 0.42)
    else if (biome === 'grass' || biome === 'forest') {
      this.moisture[index] = Math.max(42, this.moisture[index]!)
      this.fertility[index] = Math.max(45, this.fertility[index]!)
    }
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
        const elevNoise = fbm(nx * 4.2, ny * 4.2, seed)
        const moist = fbm(nx * 5.1 + 40, ny * 5.1 + 40, seed + 99)
        const dist =
          Math.hypot(nx - 0.5, ny - 0.5) * 1.35 +
          (fbm(nx * 3, ny * 3, seed + 7) - 0.5) * 0.15

        // Island falloff + noise → absolute elevation used by hydrology later.
        const elevation = Math.max(0, Math.min(100, (elevNoise * 78 + (1 - dist) * 42 - 8)))
        let biome: Biome
        if (dist > 0.62 || elevNoise < 0.32) {
          biome = elevNoise < 0.28 ? 'deepWater' : 'water'
        } else if (elevNoise < 0.38) {
          biome = 'sand'
        } else if (elevNoise > 0.72) {
          biome = moist > 0.55 ? 'snow' : 'mountain'
        } else if (moist > 0.58 && elevNoise > 0.42) {
          biome = 'forest'
        } else {
          biome = 'grass'
        }
        const index = this.index(x, y)
        this.tiles[index] = biome
        this.elevation[index] = biome === 'deepWater' ? Math.min(18, elevation * 0.35) : biome === 'water' ? Math.min(28, elevation * 0.55) : elevation
        this.vegetation[index] = biome === 'forest' ? 100 : biome === 'grass' ? 55 + ((elevNoise * 40) | 0) : 0
        this.moisture[index] = biome === 'water' || biome === 'deepWater' ? 100 : Math.round(24 + moist * 70)
        this.fertility[index] = biome === 'grass' || biome === 'forest' ? Math.round(35 + moist * 50 + elevNoise * 10) : Math.round(12 + moist * 22)
        this.surfaceWater[index] = 0
        this.temperature[index] = 16
      }
    }
    this.carveRivers(seed)
    this.creatures = []
    this.villages = []
    this.buildings = []
    this.deaths = []
    this.events = []
    this.populationHistory = []
    this.fires = []
    this.meteors = []
    this.nextId = 1
    this.nextVillageId = 1
    this.tick = 0
    this.weather = 'clear'
    this.weatherUntil = 0
    this.windAngle = this.random.next() * Math.PI * 2
    this.windStrength = 0.25 + this.random.next() * 0.35
    this.rainEffects = []
    this.revision++
    for (let i = 0; i < 36; i++) this.terrainVersions[i]++
    this.refreshTemperature()
    this.recount()
    engine.attach(this)
    engine.hydrateFromVillages(this.villages)
  }

  /** Trace a few downhill streams so continents start with believable rivers. */
  private carveRivers(seed: number): void {
    const starts: { x: number; y: number; elev: number }[] = []
    for (let y = 4; y < this.height - 4; y += 3) for (let x = 4; x < this.width - 4; x += 3) {
      const elev = this.elevation[this.index(x, y)]!
      const biome = this.get(x, y)
      if (elev > 62 && biome !== 'water' && biome !== 'deepWater') starts.push({ x, y, elev })
    }
    starts.sort((a, b) => b.elev - a.elev)
    const rivers = Math.min(7, Math.max(3, Math.floor(starts.length / 18)))
    for (let r = 0; r < rivers; r++) {
      let x = starts[r]!.x, y = starts[r]!.y
      for (let step = 0; step < 90; step++) {
        const biome = this.get(x, y)
        if (biome === 'deepWater') break
        if (biome !== 'water') {
          this.tiles[this.index(x, y)] = 'water'
          this.moisture[this.index(x, y)] = 100
          this.vegetation[this.index(x, y)] = 0
          this.surfaceWater[this.index(x, y)] = 0
        }
        let nextX = x, nextY = y, best = this.elevation[this.index(x, y)]!
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const nx = x + dx, ny = y + dy
          if (!this.inBounds(nx, ny)) continue
          const elev = this.elevation[this.index(nx, ny)]! + (hash(nx, ny, seed + r) - 0.5) * 4
          if (elev < best) { best = elev; nextX = nx; nextY = ny }
        }
        if (nextX === x && nextY === y) break
        x = nextX; y = nextY
      }
    }
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
      // Predators begin with enough reserves to roam before their first hunt.
      energy: kind === 'wolf' ? 86 : kind === 'human' ? 82 : 70,
      // A starter population should settle before it starts growing. Rabbits
      // receive a longer first cooldown; newborns are also protected by age.
      breedCooldown: kind === 'rabbit' ? 45 + this.random.next() * 60 : 10 + this.random.next() * 9,
      age: 0,
      activity: 'exploring',
      // Freshly created beings set off right away instead of waiting for the
      // first decision cycle, which makes a new world feel immediately alive.
      decisionIn: 0.15 + this.random.next() * 0.35,
      hurt: 0,
      attackCooldown: 0,
      intent: 'none',
      intentReason: 'none',
      goalUntil: 0,
      waterEscapeUntil: 0,
      task: kind === 'human' ? 'idle' : undefined,
    }
    this.creatures.push(c)
    this.revision++
    this.recount()
    return c
  }

  recordDeath(creature: Creature, cause: DeathCause): void {
    this.deaths.unshift({ id: creature.id, kind: creature.kind, x: creature.x, y: creature.y, cause, tick: this.tick })
    if (this.deaths.length > 12) this.deaths.length = 12
    this.recordEvent('death', creature.x, creature.y, creature.kind, cause)
    this.revision++
  }

  recordEvent(kind: WorldEventKind, x: number, y: number, creature?: CreatureKind, cause?: DeathCause, label?: string): void {
    const latest = this.events[0]
    // Repeated nearby events of the same kind become one readable item.
    if (latest && latest.kind === kind && latest.creature === creature && latest.cause === cause && latest.label === label && this.tick - latest.tick < 20 * 12 && (latest.x - x) ** 2 + (latest.y - y) ** 2 < 64) {
      latest.count++
      latest.tick = this.tick
    } else {
      this.events.unshift({ id: this.nextId++, kind, x, y, tick: this.tick, creature, cause, label, count: 1 })
      if (this.events.length > 30) this.events.length = 30
    }
    this.revision++
  }

  capturePopulationHistory(): void {
    if (this.tick % 100 !== 0) return
    this.populationHistory.push({ tick: this.tick, ...this.population })
    if (this.populationHistory.length > 24) this.populationHistory.shift()
  }

  populationTrend(kind: CreatureKind): number {
    if (this.populationHistory.length < 2) return 0
    return this.populationHistory[this.populationHistory.length - 1]![kind] - this.populationHistory[0]![kind]
  }

  buildingAt(x: number, y: number): Building | undefined { return this.buildings.find(b => b.x === x && b.y === y) }

  private waterNear(x: number, y: number): boolean {
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (this.inBounds(x + dx, y + dy) && (this.get(x + dx, y + dy) === 'water' || this.get(x + dx, y + dy) === 'deepWater')) return true
    return false
  }

  private fertileNear(x: number, y: number): boolean {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      if (!this.inBounds(x + dx, y + dy)) continue
      if ((this.get(x + dx, y + dy) === 'grass' || this.get(x + dx, y + dy) === 'forest') && this.fertilityAt(x + dx, y + dy) > 55) return true
    }
    return false
  }

  /** Cut forest biomass into village wood; may convert depleted forest to grass. */
  chopTree(x: number, y: number, amount: number): number {
    if (!this.inBounds(x, y) || this.get(x, y) !== 'forest') return 0
    const index = this.index(x, y)
    const previous = this.vegetation[index]!
    const taken = Math.min(amount, previous)
    this.vegetation[index] = previous - taken
    if (this.vegetation[index]! < 18) {
      this.tiles[index] = 'grass'
      this.vegetation[index] = Math.max(12, this.vegetation[index]!)
      this.touch(x, y)
    } else if (Math.floor(previous / 20) !== Math.floor(this.vegetation[index]! / 20)) this.touch(x, y)
    this.revision++
    return taken / 10
  }

  /** Chip mountain stone into village stone using fertility as hardness reserve. */
  mineStone(x: number, y: number, amount: number): number {
    if (!this.inBounds(x, y) || this.get(x, y) !== 'mountain') return 0
    const index = this.index(x, y)
    const previous = this.fertility[index]!
    const taken = Math.min(amount, Math.max(0, previous - 4))
    this.fertility[index] = previous - taken
    this.revision++
    return taken / 8
  }

  /** Pick berries from lush grass or forest undergrowth. */
  pickBerries(x: number, y: number, amount: number): number {
    if (!this.inBounds(x, y)) return 0
    const biome = this.get(x, y)
    if (biome !== 'grass' && biome !== 'forest') return 0
    if (this.vegetationAt(x, y) < 18) return 0
    const index = this.index(x, y)
    const previous = this.vegetation[index]!
    const taken = Math.min(amount, previous - 8)
    if (taken <= 0) return 0
    this.vegetation[index] = previous - taken
    if (Math.floor(previous / 20) !== Math.floor(this.vegetation[index]! / 20)) this.touch(x, y)
    this.revision++
    return taken / 6
  }

  nearestBerry(cx: number, cy: number, radius: number): { x: number; y: number } | null {
    const minX = Math.max(0, Math.floor(cx - radius)), maxX = Math.min(this.width - 1, Math.ceil(cx + radius))
    const minY = Math.max(0, Math.floor(cy - radius)), maxY = Math.min(this.height - 1, Math.ceil(cy + radius))
    let best: { x: number; y: number } | null = null, bestDistance = Infinity
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const biome = this.get(x, y)
      if ((biome !== 'grass' && biome !== 'forest') || this.vegetationAt(x, y) < 28) continue
      const distance = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
      if (distance < bestDistance) { bestDistance = distance; best = { x, y } }
    }
    return best
  }

  nearestShore(cx: number, cy: number, radius: number): { x: number; y: number } | null {
    const water = this.nearestBiome(cx, cy, 'water', radius) ?? this.nearestBiome(cx, cy, 'deepWater', radius)
    if (!water) return null
    return this.nearestWalkable(water.x + 0.5, water.y + 0.5, 4) ?? water
  }

  private assignVillageTasks(village: Village, members: Creature[], active: Building | undefined): void {
    const nearWater = this.waterNear(village.x, village.y)
    const workers = members.filter(c => c.task !== 'raiding')
    const needs: { task: HumanTask; weight: number }[] = []
    if (active) needs.push({ task: 'building', weight: Math.min(workers.length, 2) })
    needs.push({ task: 'foraging', weight: village.food < 40 ? 3 : 1 })
    needs.push({ task: 'hunting', weight: village.food < 35 ? 2 : 1 })
    if (nearWater) needs.push({ task: 'fishing', weight: village.food < 45 ? 2 : 1 })
    needs.push({ task: 'lumber', weight: village.wood < 30 ? 2 : 1 })
    needs.push({ task: 'mining', weight: village.stone < 18 ? 2 : 1 })
    const slots: HumanTask[] = []
    for (const need of needs) for (let i = 0; i < need.weight; i++) slots.push(need.task)
    for (let i = 0; i < workers.length; i++) {
      const human = workers[i]!
      human.task = slots[i % slots.length] ?? 'foraging'
      human.activity = 'working'
    }
  }

  evaluateVillageProgress(village: Village): void {
    const hasHome = this.buildings.some(b => b.villageId === village.id && b.type === 'home' && b.progress >= 1)
    const hasSawmill = this.buildings.some(b => b.villageId === village.id && b.type === 'sawmill' && b.progress >= 1)
    const discoveries = evaluateKnowledge(village, this.fertileNear(village.x, village.y))
    const research = evaluateTech(village, hasHome, hasSawmill)
    for (const id of discoveries) this.recordEvent('discovery', village.x + 0.5, village.y + 0.5, undefined, undefined, id)
    for (const id of research) this.recordEvent('research', village.x + 0.5, village.y + 0.5, undefined, undefined, id)
    // Drop queued buildings that are no longer allowed; append newly unlocked ones not yet built.
    const built = new Set(this.buildings.filter(b => b.villageId === village.id).map(b => b.type))
    village.buildingQueue = village.buildingQueue.filter(type => techAllowsBuilding(village, type) && !built.has(type))
    for (const type of (['home', 'storehouse', 'farm', 'sawmill'] as const)) {
      if (techAllowsBuilding(village, type) && !built.has(type) && !village.buildingQueue.includes(type)) village.buildingQueue.push(type)
    }
  }

  private villageNameAndColor(index: number): { name: string; color: string } {
    return VILLAGE_STYLES[index % VILLAGE_STYLES.length]!
  }

  private createVillage(x: number, y: number, members: Creature[], opts?: {
    food?: number; wood?: number; stone?: number
    knowledge?: Village['knowledge']; tech?: Village['tech']; buildingQueue?: Village['buildingQueue']
  }): Village {
    const style = this.villageNameAndColor(this.villages.length)
    const village: Village = {
      id: this.nextVillageId++,
      name: style.name,
      x: Math.floor(x),
      y: Math.floor(y),
      color: style.color,
      food: opts?.food ?? 48,
      wood: opts?.wood ?? 12,
      stone: opts?.stone ?? 5,
      members: members.map(c => c.id),
      buildingQueue: opts?.buildingQueue ? [...opts.buildingQueue] : ['home'],
      knowledge: opts?.knowledge ? [...opts.knowledge] : ['foraging'],
      tech: opts?.tech ? [...opts.tech] : [],
      progress: emptyProgress(),
      relations: {},
    }
    for (const other of this.villages) {
      ensureRelation(engine.factions, village.id, other.id)
      village.relations[other.id] = 0
      other.relations[village.id] = 0
    }
    this.villages.push(village)
    for (const c of members) {
      c.villageId = village.id
      c.task = 'foraging'
      c.activity = 'working'
    }
    this.recordEvent('founding', village.x + 0.5, village.y + 0.5, undefined, undefined, village.name)
    if (!village.knowledge.includes('foraging')) village.knowledge.unshift('foraging')
    if (!opts?.knowledge) this.recordEvent('discovery', village.x + 0.5, village.y + 0.5, undefined, undefined, 'foraging')
    engine.onVillageFounded(this, village)
    this.revision++
    return village
  }

  private findFoundingSiteNear(cx: number, cy: number, radius = 10): { x: number; y: number } | null {
    let best: { x: number; y: number; score: number } | null = null
    for (let y = Math.max(4, Math.floor(cy) - radius); y <= Math.min(this.height - 5, Math.floor(cy) + radius); y++) {
      for (let x = Math.max(4, Math.floor(cx) - radius); x <= Math.min(this.width - 5, Math.floor(cx) + radius); x++) {
        const biome = this.get(x, y)
        if (biome !== 'grass' && biome !== 'forest' && biome !== 'sand') continue
        if (this.nearestVillageDistance(x + 0.5, y + 0.5) < World.MIN_FOUND_DISTANCE) continue
        const water = this.waterNear(x, y) ? 8 : 0
        const veg = this.vegetationAt(x, y) * 0.04
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        const score = water + veg + (biome === 'grass' ? 4 : 1) - dist * 0.2
        if (!best || score > best.score) best = { x, y, score }
      }
    }
    return best
  }

  private recruitNearbyUnsettled(): void {
    const unsettled = this.creatures.filter(c => c.kind === 'human' && !c.villageId && c.age >= 12 && c.life > 0)
    for (const human of unsettled) {
      let nearest: Village | undefined
      let nearestDist = Infinity
      for (const village of this.villages) {
        const d = Math.hypot(village.x + 0.5 - human.x, village.y + 0.5 - human.y)
        if (d < nearestDist) { nearest = village; nearestDist = d }
      }
      if (!nearest || nearestDist > 9) continue
      const pop = this.creatures.filter(c => c.villageId === nearest!.id && c.life > 0).length
      if (pop >= 16) continue
      if (this.random.next() > 0.35) continue
      human.villageId = nearest.id
      human.task = 'foraging'
      human.activity = 'working'
    }
  }

  private tryFoundFromUnsettled(): void {
    if (this.villages.length >= World.MAX_VILLAGES) return
    const unsettled = this.creatures.filter(c => c.kind === 'human' && !c.villageId && c.age >= 12 && c.life > 0)
    if (unsettled.length < 4) return
    const order = [...unsettled]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random.next() * (i + 1))
      ;[order[i], order[j]] = [order[j]!, order[i]!]
    }
    for (const seed of order) {
      if (this.nearestVillageDistance(seed.x, seed.y) < World.MIN_FOUND_DISTANCE && this.villages.length > 0) continue
      const cluster = unsettled.filter(c => Math.hypot(c.x - seed.x, c.y - seed.y) < 10).slice(0, 8)
      if (cluster.length < 4) continue
      const cx = cluster.reduce((s, c) => s + c.x, 0) / cluster.length
      const cy = cluster.reduce((s, c) => s + c.y, 0) / cluster.length
      const site = this.findFoundingSiteNear(cx, cy, 12)
        ?? (this.villages.length === 0 && this.get(Math.floor(seed.x), Math.floor(seed.y)) === 'grass'
          ? { x: Math.floor(seed.x), y: Math.floor(seed.y) }
          : null)
      if (!site) continue
      this.createVillage(site.x, site.y, cluster)
      return
    }
  }

  private tryVillageFission(): void {
    if (this.villages.length >= World.MAX_VILLAGES) return
    for (const parent of [...this.villages]) {
      if (this.villages.length >= World.MAX_VILLAGES) return
      const members = this.creatures.filter(c => c.villageId === parent.id && c.life > 0)
      if (members.length < 12 || parent.food < 45 || parent.wood < 14) continue
      const pressure = members.length - 11
      if (this.random.next() > 0.04 + pressure * 0.015) continue
      const settlers = members
        .filter(c => c.age >= 16 && c.age < MAX_AGE.human * 0.75 && c.energy > 55 && c.task !== 'raiding')
        .slice(0, 4 + Math.floor(this.random.next() * 3))
      if (settlers.length < 4) continue
      const angle = this.random.next() * Math.PI * 2
      const dist = World.MIN_FOUND_DISTANCE + 4 + this.random.next() * 10
      const site = this.findFoundingSiteNear(parent.x + Math.cos(angle) * dist, parent.y + Math.sin(angle) * dist, 14)
      if (!site) continue
      const foodShare = Math.min(22, parent.food * 0.28)
      const woodShare = Math.min(10, parent.wood * 0.28)
      parent.food -= foodShare
      parent.wood -= woodShare
      this.createVillage(site.x, site.y, settlers, {
        food: foodShare + 8,
        wood: woodShare + 4,
        stone: Math.min(4, parent.stone * 0.2),
        knowledge: parent.knowledge.filter(k => k === 'foraging' || k === 'hunting' || k === 'woodcraft' || this.random.next() < 0.5),
        tech: parent.tech.filter(() => this.random.next() < 0.35),
        buildingQueue: ['home'],
      })
      for (const s of settlers) {
        s.x = site.x + 0.5 + (this.random.next() - 0.5) * 2
        s.y = site.y + 0.5 + (this.random.next() - 0.5) * 2
      }
      return
    }
  }

  hostility(village: Village, otherId: number): number {
    return engine.hostility(village.id, otherId)
  }

  isAtWar(village: Village, otherId: number): boolean {
    return engine.atWar(village.id, otherId)
  }

  advanceVillages(): void {
    this.tryFoundFromUnsettled()
    this.recruitNearbyUnsettled()
    this.tryVillageFission()
    const season = this.season()
    const farmBoost = season === 'spring' ? 1.35 : season === 'summer' ? 1.1 : season === 'autumn' ? 0.85 : 0.35
    for (const village of this.villages) {
      const members = this.creatures.filter(c => c.villageId === village.id && c.life > 0)
      village.members = members.map(c => c.id)
      if (!members.length) continue
      if (this.dayPhase() === 'night' && Math.floor(this.tick / 20) % 24 === 0) village.progress.nights++

      const active = this.buildings.find(b => b.villageId === village.id && b.progress < 1)
      this.assignVillageTasks(village, members, active)

      const farms = this.buildings.filter(b => b.villageId === village.id && b.type === 'farm' && b.progress >= 1)
      let farmYield = 0
      if (hasTech(village, 'farm') || farms.length) {
        for (const farm of farms) {
          const soil = this.fertilityAt(farm.x, farm.y) / 100
          const wet = this.moistureAt(farm.x, farm.y) / 100
          const warmth = Math.max(0, Math.min(1, (this.temperatureAt(farm.x, farm.y) - 2) / 28))
          farmYield += soil * wet * warmth * farmBoost * 1.8
          village.progress.farmTicks++
        }
      }
      village.food = Math.max(0, village.food - foodUpkeep(village, members.length) + farmYield)
      for (const human of members) if (human.energy < 86 && village.food >= 1) { human.energy = Math.min(100, human.energy + 12); village.food -= 1 }

      const builders = members.filter(c => c.task === 'building').length
      if (active && builders) {
        const speed = hasTech(village, 'wood_tools') ? 0.055 : 0.04
        active.progress = Math.min(1, active.progress + builders * speed)
      } else if (!active) {
        const built = new Set(this.buildings.filter(b => b.villageId === village.id).map(b => b.type))
        village.buildingQueue = village.buildingQueue.filter(type => !built.has(type) && techAllowsBuilding(village, type))
        const type = village.buildingQueue[0]
        const cost = type === 'home' ? [8, 3] : type === 'storehouse' ? [12, 4] : type === 'farm' ? [6, 0] : type === 'sawmill' ? [16, 6] : null
        if (type && cost && village.wood >= cost[0] && village.stone >= cost[1]) {
          village.wood -= cost[0]; village.stone -= cost[1]; village.buildingQueue.shift()
          const offset = [[2, 1], [-2, 1], [1, -2], [-2, -2]][this.buildings.filter(b => b.villageId === village.id).length] ?? [3, 3]
          this.buildings.push({ id: this.buildings.length + 1, villageId: village.id, type, x: village.x + offset[0], y: village.y + offset[1], progress: 0.02 })
        }
      }
      this.evaluateVillageProgress(village)
      this.revision++
    }
  }

  /** God-tool brushes that write raw simulation layer values. */
  paintLayer(cx: number, cy: number, layer: 'heat' | 'humidity' | 'elevation' | 'fertility', amount: number, radius: number): void {
    const r2 = radius * radius
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.inBounds(x, y)) continue
        const dx = x - cx, dy = y - cy
        if (dx * dx + dy * dy > r2) continue
        const i = this.index(x, y)
        const falloff = 1 - Math.sqrt(dx * dx + dy * dy) / Math.max(1, radius)
        const delta = amount * falloff
        if (layer === 'heat') this.temperature[i] = Math.max(-12, Math.min(46, this.temperature[i]! + delta))
        else if (layer === 'humidity') {
          this.moisture[i] = Math.max(0, Math.min(100, this.moisture[i]! + delta))
          if (delta > 0) this.surfaceWater[i] = Math.min(100, this.surfaceWater[i]! + delta * 0.35)
        } else if (layer === 'elevation') this.elevation[i] = Math.max(0, Math.min(100, this.elevation[i]! + delta))
        else this.fertility[i] = Math.max(0, Math.min(100, this.fertility[i]! + delta))
        this.touch(x, y)
      }
    }
    this.revision++
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

  moistureAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.moisture[this.index(x, y)]! : 0
  }

  fertilityAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.fertility[this.index(x, y)]! : 0
  }

  elevationAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.elevation[this.index(x, y)]! : 0
  }

  temperatureAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.temperature[this.index(x, y)]! : 0
  }

  surfaceWaterAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.surfaceWater[this.index(x, y)]! : 0
  }

  season(): Season {
    // ~12 world-hours per season keeps climate readable without wiping life at ×4.
    return (['spring', 'summer', 'autumn', 'winter'] as const)[Math.floor(this.tick / (20 * 720)) % 4]!
  }

  /** 0…1 through the current day (midnight → midnight). */
  dayProgress(): number {
    const minutes = Math.floor(this.tick / 20)
    return (minutes % DAY_LENGTH) / DAY_LENGTH
  }

  dayPhase(): DayPhase {
    const t = this.dayProgress()
    if (t < 0.22) return 'night'
    if (t < 0.3) return 'dawn'
    if (t < 0.72) return 'day'
    if (t < 0.8) return 'dusk'
    return 'night'
  }

  /** Solar warmth multiplier: night ~0.35, noon ~1.15. */
  solarFactor(): number {
    const t = this.dayProgress()
    const sun = Math.sin(((t + 0.75) % 1) * Math.PI * 2)
    return 0.55 + Math.max(0, sun) * 0.6
  }

  /** Recompute local temperatures from elevation, latitude, season, weather and sun. */
  refreshTemperature(): void {
    const season = this.season()
    const base = season === 'summer' ? 25 : season === 'winter' ? 9 : season === 'spring' ? 17 : 13
    const weatherBias = this.weather === 'drought' ? 3.5 : this.weather === 'storm' ? -2.5 : this.weather === 'rain' ? -1.2 : 0
    const solar = this.solarFactor()
    for (let y = 0; y < this.height; y++) {
      const latitude = 1 - y / (this.height - 1)
      for (let x = 0; x < this.width; x++) {
        const index = this.index(x, y)
        const elev = this.elevation[index]!
        const biome = this.tiles[index]!
        // Lapse only above foothills so valleys stay temperate and peaks feel alpine.
        const altitudeCooling = Math.max(0, elev - 48) * 0.22
        let temp = base + weatherBias + (latitude - 0.45) * 6 + (solar - 0.75) * 7 - altitudeCooling
        if (biome === 'snow') temp -= 5
        if (biome === 'sand') temp += 3
        if (biome === 'forest') temp -= 1
        if (biome === 'lava') temp += 16
        if (biome === 'water' || biome === 'deepWater') temp -= 1
        if (this.surfaceWater[index]! > 20) temp -= 0.8
        this.temperature[index] = Math.max(-12, Math.min(46, temp))
      }
    }
  }

  /** Advances a deterministic local climate once per world minute. */
  updateClimate(): void {
    if (this.tick >= this.weatherUntil) {
      const season = this.season()
      const roll = this.random.next()
      this.weather = season === 'summer' && roll < 0.32 ? 'drought'
        : season === 'summer' && roll < 0.42 ? 'storm'
          : season === 'spring' && roll < 0.18 ? 'storm'
            : season === 'spring' && roll < 0.55 ? 'rain'
              : season === 'autumn' && roll < 0.22 ? 'storm'
                : season === 'autumn' && roll < 0.42 ? 'rain'
                  : season === 'winter' && roll < 0.28 ? 'rain'
                    : 'clear'
      const duration = this.weather === 'clear' ? 75 : this.weather === 'storm' ? 28 : this.weather === 'rain' ? 42 : 58
      this.weatherUntil = this.tick + duration * 20
      this.windAngle = (this.windAngle + (this.random.next() - 0.5) * 1.4 + Math.PI * 2) % (Math.PI * 2)
      this.windStrength = this.weather === 'storm' ? 0.75 + this.random.next() * 0.25 : this.weather === 'rain' ? 0.45 + this.random.next() * 0.25 : 0.2 + this.random.next() * 0.3
    }
    this.refreshTemperature()
    const season = this.season()
    const evaporation = (season === 'summer' ? 0.42 : season === 'winter' ? 0.12 : 0.25) * this.solarFactor()
    const rainfall = this.weather === 'storm' ? 2.8 : this.weather === 'rain' ? 1.65 : 0
    const drought = this.weather === 'drought' ? 0.72 : 0
    for (let i = 0; i < this.tiles.length; i++) {
      const biome = this.tiles[i]!
      if (biome === 'water' || biome === 'deepWater') { this.moisture[i] = 100; continue }
      this.moisture[i] = Math.max(0, Math.min(100, this.moisture[i]! + rainfall - evaporation - drought))
      if (rainfall > 0) this.surfaceWater[i] = Math.min(100, this.surfaceWater[i]! + rainfall * (this.weather === 'storm' ? 2.2 : 1.1))
      if (biome === 'grass' || biome === 'forest') {
        const recovery = this.weather === 'rain' || this.weather === 'storm' ? 0.09 : this.weather === 'drought' ? -0.045 : 0.018
        this.fertility[i] = Math.max(4, Math.min(100, this.fertility[i]! + recovery))
      } else if (biome === 'ash') this.fertility[i] = Math.min(72, this.fertility[i]! + (this.moisture[i]! > 45 ? 0.1 : 0))
    }
    this.updateHydrology()
    this.evolveBiomes()
  }

  /** Downhill runoff: excess surface water drains to lower neighbors and feeds rivers/floods. */
  updateHydrology(): void {
    const next = this.surfaceWaterNext
    next.set(this.surfaceWater)
    let flooded = 0
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const index = this.index(x, y)
        const biome = this.tiles[index]!
        if (biome === 'water' || biome === 'deepWater' || biome === 'lava') { next[index] = 0; continue }
        const water = this.surfaceWater[index]!
        if (water < 4) {
          next[index] = Math.max(0, water - 0.35 * this.solarFactor())
          continue
        }
        let lowest = index, lowestElev = this.elevation[index]!
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = this.index(x + dx, y + dy)
          const elev = this.elevation[ni]! - (this.tiles[ni] === 'water' || this.tiles[ni] === 'deepWater' ? 12 : 0)
          if (elev < lowestElev) { lowestElev = elev; lowest = ni }
        }
        const flow = Math.min(water * 0.42, Math.max(0, water - 8))
        next[index] = Math.max(0, water - flow - 0.45 * this.solarFactor())
        if (this.tiles[lowest] === 'water' || this.tiles[lowest] === 'deepWater') continue
        next[lowest] = Math.min(100, next[lowest]! + flow)
      }
    }
    const swap = this.surfaceWater
    this.surfaceWater = next
    this.surfaceWaterNext = swap
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.surfaceWater[i]! > 72 && WALKABLE.has(this.tiles[i]!) && this.tiles[i] !== 'mountain' && this.tiles[i] !== 'snow') {
        const x = i % this.width, y = Math.floor(i / this.width)
        if (this.elevation[i]! < 38 && this.random.next() < 0.08) {
          this.tiles[i] = 'water'
          this.vegetation[i] = 0
          this.moisture[i] = 100
          this.surfaceWater[i] = 0
          this.touch(x, y)
          flooded++
        } else this.moisture[i] = Math.min(100, this.moisture[i]! + 2)
      }
    }
    if (flooded > 0) {
      this.recordEvent('flood', this.width / 2, this.height / 2)
      engine.bus.emit('flood', this.tick, { x: this.width / 2, y: this.height / 2, tiles: flooded })
    }
  }

  /** Temperature + moisture push biomes toward believable successors. */
  evolveBiomes(): void {
    let froze = 0
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const index = this.index(x, y)
      const biome = this.tiles[index]!
      if (biome === 'lava' || biome === 'deepWater') continue
      const temp = this.temperature[index]!
      const moist = this.moisture[index]!
      const elev = this.elevation[index]!
      if (biome === 'water') {
        if (temp < -2 && this.random.next() < 0.04) {
          this.tiles[index] = 'snow'
          this.vegetation[index] = 0
          this.touch(x, y)
          froze++
        }
        continue
      }
      if (biome === 'snow' && temp > 8 && elev < 70 && this.random.next() < 0.03) {
        this.tiles[index] = elev > 58 ? 'mountain' : moist > 55 ? 'grass' : 'sand'
        this.vegetation[index] = this.tiles[index] === 'grass' ? 20 : 0
        this.touch(x, y)
        continue
      }
      if ((biome === 'grass' || biome === 'forest') && temp < -6 && elev > 62 && this.random.next() < 0.02) {
        this.tiles[index] = 'snow'
        this.vegetation[index] = 0
        this.touch(x, y)
        froze++
        continue
      }
      if (biome === 'grass' && moist < 18 && temp > 28 && this.weather === 'drought' && this.random.next() < 0.02) {
        this.tiles[index] = 'sand'
        this.vegetation[index] = 0
        this.touch(x, y)
        continue
      }
      if (biome === 'forest' && moist < 22 && this.weather === 'drought' && this.random.next() < 0.015) {
        this.tiles[index] = 'grass'
        this.vegetation[index] = 35
        this.touch(x, y)
        continue
      }
      if (biome === 'grass' && moist > 68 && temp > 8 && temp < 28 && this.vegetation[index]! > 85 && this.random.next() < 0.008) {
        this.tiles[index] = 'forest'
        this.vegetation[index] = 100
        this.touch(x, y)
      }
    }
    if (froze > 4) {
      this.recordEvent('freeze', this.width / 2, this.height / 2)
      engine.bus.emit('freeze', this.tick, { tiles: froze })
    }
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

  nearestBiome(cx: number, cy: number, biome: Biome, radius: number): { x: number; y: number } | null {
    const minX = Math.max(0, Math.floor(cx - radius)), maxX = Math.min(this.width - 1, Math.ceil(cx + radius))
    const minY = Math.max(0, Math.floor(cy - radius)), maxY = Math.min(this.height - 1, Math.ceil(cy + radius))
    let best: { x: number; y: number } | null = null, bestDistance = Infinity
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (this.get(x, y) !== biome) continue
      const distance = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
      if (distance < bestDistance) { bestDistance = distance; best = { x, y } }
    }
    return best
  }

  /** Find dry, traversable terrain so creatures can recover after terrain is painted beneath them. */
  nearestWalkable(cx: number, cy: number, radius = 24): { x: number; y: number } | null {
    const minX = Math.max(0, Math.floor(cx - radius)), maxX = Math.min(this.width - 1, Math.ceil(cx + radius))
    const minY = Math.max(0, Math.floor(cy - radius)), maxY = Math.min(this.height - 1, Math.ceil(cy + radius))
    let best: { x: number; y: number } | null = null, bestDistance = Infinity
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (!WALKABLE.has(this.get(x, y)) || this.surfaceWater[this.index(x, y)]! > 55) continue
      const distance = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
      if (distance < bestDistance) { bestDistance = distance; best = { x, y } }
    }
    return best
  }

  /** A small, deterministic habitat sample used by wildlife decisions. */
  habitatScore(x: number, y: number, kind: 'rabbit' | 'wolf'): number {
    if (!this.inBounds(x, y) || !WALKABLE.has(this.get(x, y))) return -Infinity
    const biome = this.get(x, y)
    const vegetation = this.vegetationAt(x, y)
    const moisture = this.moistureAt(x, y)
    const fertility = this.fertilityAt(x, y)
    const temp = this.temperatureAt(x, y)
    const flood = this.surfaceWaterAt(x, y)
    const fireNear = this.fires.some(f => (f.x - x) ** 2 + (f.y - y) ** 2 < 25)
    if (fireNear || biome === 'lava' || flood > 55) return -Infinity
    const comfort = kind === 'rabbit' ? temp > 0 && temp < 30 ? 12 : -18 : temp > -8 && temp < 28 ? 8 : -10
    if (kind === 'rabbit') {
      const cover = biome === 'forest' ? 30 : biome === 'grass' ? 10 : 0
      return vegetation * 0.75 + moisture * 0.22 + fertility * 0.16 + cover + comfort - flood * 0.35
    }
    const prey = this.spatial.nearby(x + 0.5, y + 0.5, 7).filter(c => c.kind === 'rabbit' && c.life > 0).length
    const nearestVillage = this.nearestVillageDistance(x, y)
    return prey * 28 + moisture * 0.08 + fertility * 0.04 + comfort - Math.max(0, 13 - nearestVillage) * 9
  }

  /** Select from a bounded ring of samples, not a full map scan. */
  bestHabitat(cx: number, cy: number, kind: 'rabbit' | 'wolf', radius = 24): { x: number; y: number; score: number } | null {
    let best: { x: number; y: number; score: number } | null = null
    const stride = 4
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(this.height - 1, Math.ceil(cy + radius)); y += stride) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(this.width - 1, Math.ceil(cx + radius)); x += stride) {
        const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (distance < 5 || distance > radius) continue
        const score = this.habitatScore(x, y, kind) - distance * 0.42
        if (!best || score > best.score) best = { x, y, score }
      }
    }
    return best
  }

  nearestVillageDistance(x: number, y: number): number {
    if (!this.villages.length) return Infinity
    return Math.min(...this.villages.map(v => Math.hypot(v.x + 0.5 - x, v.y + 0.5 - y)))
  }

  regrowNature(): void {
    const seasonGrowth = this.season() === 'spring' ? 1.25 : this.season() === 'summer' ? 0.9 : this.season() === 'autumn' ? 0.72 : 0.38
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const index = this.index(x, y)
        const biome = this.tiles[index]!
        if (biome === 'grass') {
          const previous = this.vegetation[index]!
          const water = this.moisture[index]! / 100
          const soil = this.fertility[index]! / 100
          const growth = water < 0.22 || this.weather === 'drought' ? -0.42 : (0.16 + water * soil * 0.92 * seasonGrowth)
          this.vegetation[index] = Math.max(0, Math.min(100, previous + growth))
          if (Math.floor(previous / 20) !== Math.floor(this.vegetation[index]! / 20)) this.touch(x, y)
          continue
        }
        if (biome === 'ash' && this.moisture[index]! > 52 && this.fertility[index]! > 24 && this.weather !== 'drought' && this.random.next() < 0.006) {
          this.tiles[index] = 'grass'
          this.vegetation[index] = 12
          this.touch(x, y)
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
    let ignited = false
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.inBounds(x, y)) continue
        const b = this.get(x, y)
        if (b === 'forest' || b === 'grass') {
          if (!this.fires.some((f) => f.x === x && f.y === y)) {
            if (this.fires.length >= MAX_FIRES) return
            this.fires.push({ x, y, heat: 1 })
            ignited = true
            this.revision++
          }
        }
      }
    }
    if (ignited) this.recordEvent('fire', cx + 0.5, cy + 0.5)
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
        const index = this.index(x, y)
        this.moisture[index] = Math.min(100, this.moisture[index]! + 38)
        this.fertility[index] = Math.min(100, this.fertility[index]! + 4)
        this.surfaceWater[index] = Math.min(100, this.surfaceWater[index]! + 28)
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
