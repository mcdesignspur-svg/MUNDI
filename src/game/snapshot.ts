import { ACTIVITY_NAMES, BIOME_COLORS, MAX_AGENTS, MAX_HEALTH, emptyProgress, type AnimalIntent, type AnimalReason, type Building, type Creature, type DeathRecord, type HumanTask, type KnowledgeId, type PopulationSample, type TechId, type Village, type Weather, type WorldEvent } from './types'
import { World, WORLD_H, WORLD_W } from './world'

export interface Snapshot {
  format: 'mundi'
  version: 1
  seed: string
  width: number
  height: number
  tick: number
  randomState: number
  nextId: number
  nextVillageId?: number
  tiles: World['tiles']
  vegetation: number[]
  moisture: number[]
  fertility: number[]
  elevation?: number[]
  surfaceWater?: number[]
  weather: Weather
  weatherUntil: number
  windAngle?: number
  windStrength?: number
  creatures: Creature[]
  villages: Village[]
  buildings: Building[]
  deaths: DeathRecord[]
  events: WorldEvent[]
  populationHistory: PopulationSample[]
  fires: World['fires']
  meteors: World['meteors']
  rainEffects: World['rainEffects']
}

export function snapshot(world: World): Snapshot {
  return {
    format: 'mundi', version: 1, seed: world.seed, width: world.width, height: world.height,
    tick: world.tick, randomState: world.random.state, nextId: world.nextId, nextVillageId: world.nextVillageId,
    tiles: [...world.tiles], vegetation: Array.from(world.vegetation), moisture: Array.from(world.moisture), fertility: Array.from(world.fertility),
    elevation: Array.from(world.elevation), surfaceWater: Array.from(world.surfaceWater),
    weather: world.weather, weatherUntil: world.weatherUntil, windAngle: world.windAngle, windStrength: world.windStrength,
    creatures: world.creatures.map(c => ({ ...c })),
    villages: world.villages.map(v => ({
      ...v,
      members: [...v.members],
      buildingQueue: [...v.buildingQueue],
      knowledge: [...v.knowledge],
      tech: [...v.tech],
      progress: { ...v.progress },
      relations: { ...v.relations },
    })),
    buildings: world.buildings.map(b => ({ ...b })), deaths: world.deaths.map(d => ({ ...d })), events: world.events.map(e => ({ ...e })), populationHistory: world.populationHistory.map(p => ({ ...p })), fires: world.fires.map(f => ({ ...f })),
    meteors: world.meteors.map(m => ({ ...m })), rainEffects: world.rainEffects.map(r => ({ ...r })),
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('La partida contiene datos inválidos.')
  return value as Record<string, unknown>
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new Error('La partida contiene un valor fuera de rango.')
  return value
}
function optionalNumber(value: unknown, min: number, max: number, fallback = 0): number {
  return value === undefined ? fallback : number(value, min, max)
}
function list(value: unknown, max: number, exact = false): unknown[] {
  if (!Array.isArray(value) || value.length > max || (exact && value.length !== max)) throw new Error('El tamaño de la partida no es válido.')
  return value
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new Error('La partida contiene un tipo desconocido.')
  return value as T
}

/** Validate into a fresh world; the active world is never touched on failure. */
export function restore(input: unknown): World {
  const data = object(input)
  if (data.format !== 'mundi' || data.version !== 1) throw new Error('Este archivo no es una partida MUNDI compatible (versión 1).')
  if (data.width !== WORLD_W || data.height !== WORLD_H) throw new Error('El mapa debe ser de 96 × 96.')
  if (typeof data.seed !== 'string' || data.seed.length < 1 || data.seed.length > 64) throw new Error('La semilla no es válida.')
  const count = WORLD_W * WORLD_H
  const tiles = list(data.tiles, count, true).map(v => choice(v, Object.keys(BIOME_COLORS) as World['tiles']))
  const vegetation = list(data.vegetation, count, true).map(v => number(v, 0, 100))
  const ids = new Set<number>()
  const creatures = list(data.creatures, MAX_AGENTS).map(raw => {
    const c = object(raw)
    const kind = choice(c.kind, ['human', 'rabbit', 'wolf'] as const)
    const id = number(c.id, 1, Number.MAX_SAFE_INTEGER - 1, true)
    if (ids.has(id)) throw new Error('La partida contiene seres duplicados.')
    ids.add(id)
    const intent = c.intent === undefined ? 'none' : choice(c.intent, ['none', 'foraging', 'sheltering', 'migrating', 'fleeing', 'resting', 'stalking', 'hunting'] as AnimalIntent[])
    const intentReason = c.intentReason === undefined ? 'none' : choice(c.intentReason, ['none', 'danger', 'fire', 'water', 'food', 'habitat', 'prey', 'rest'] as AnimalReason[])
    const rawTask = c.task === undefined ? 'idle' : c.task
    const task: HumanTask = rawTask === 'gathering' ? 'foraging' : choice(rawTask, ['foraging', 'hunting', 'lumber', 'mining', 'building', 'fishing', 'raiding', 'idle'] as HumanTask[])
    return {
      id, kind, x: number(c.x, 0, WORLD_W - 0.000001), y: number(c.y, 0, WORLD_H - 0.000001),
      vx: number(c.vx, -1, 1), vy: number(c.vy, -1, 1), life: number(c.life, 0, MAX_HEALTH[kind]),
      energy: number(c.energy, -100, 100), age: number(c.age, 0, 1e12),
      breedCooldown: number(c.breedCooldown, 0, 1e6), decisionIn: number(c.decisionIn, -1, 2),
      hurt: optionalNumber(c.hurt, 0, 1), attackCooldown: optionalNumber(c.attackCooldown, 0, 2),
      intent, intentReason,
      goalX: c.goalX === undefined ? undefined : number(c.goalX, 0, WORLD_W - 0.000001),
      goalY: c.goalY === undefined ? undefined : number(c.goalY, 0, WORLD_H - 0.000001),
      goalUntil: optionalNumber(c.goalUntil, 0, 1e12, 0),
      waterEscapeUntil: optionalNumber(c.waterEscapeUntil, 0, 1e12, 0),
      villageId: c.villageId === undefined ? undefined : number(c.villageId, 1, 1000, true),
      task,
      workTimer: optionalNumber(c.workTimer, 0, 1e6, 0),
      activity: choice(c.activity, Object.keys(ACTIVITY_NAMES) as Creature['activity'][]),
    }
  })
  const firePositions = new Set<number>()
  const knowledgeOptions = ['foraging', 'hunting', 'fishing', 'woodcraft', 'stonecraft', 'farming', 'firecraft'] as const
  const techOptions = ['wood_tools', 'stone_tools', 'farm', 'sawmill', 'storehouse'] as const
  const villages = data.villages === undefined ? [] : list(data.villages, 30).map(raw => {
    const v = object(raw)
    const progressRaw = v.progress === undefined ? undefined : object(v.progress)
    const progress = emptyProgress()
    if (progressRaw) {
      progress.berries = optionalNumber(progressRaw.berries, 0, 1e9, 0)
      progress.hunts = optionalNumber(progressRaw.hunts, 0, 1e9, 0)
      progress.fish = optionalNumber(progressRaw.fish, 0, 1e9, 0)
      progress.trees = optionalNumber(progressRaw.trees, 0, 1e9, 0)
      progress.stone = optionalNumber(progressRaw.stone, 0, 1e9, 0)
      progress.nights = optionalNumber(progressRaw.nights, 0, 1e9, 0)
      progress.farmTicks = optionalNumber(progressRaw.farmTicks, 0, 1e9, 0)
    }
    const knowledge = v.knowledge === undefined ? (['foraging'] as KnowledgeId[]) : list(v.knowledge, 12).map(id => choice(id, knowledgeOptions))
    const tech = v.tech === undefined ? ([] as TechId[]) : list(v.tech, 12).map(id => choice(id, techOptions))
    const relations: Record<number, number> = {}
    if (v.relations !== undefined && v.relations !== null && typeof v.relations === 'object' && !Array.isArray(v.relations)) {
      for (const [key, value] of Object.entries(v.relations as Record<string, unknown>)) {
        const id = Number(key)
        if (!Number.isSafeInteger(id) || id < 1 || id > 1000) continue
        relations[id] = number(value, 0, 100)
      }
    }
    return {
      id: number(v.id, 1, 1000, true), name: typeof v.name === 'string' ? v.name.slice(0, 40) : 'Aldea',
      x: number(v.x, 0, WORLD_W - 1, true), y: number(v.y, 0, WORLD_H - 1, true),
      color: typeof v.color === 'string' ? v.color : '#e7bd66',
      food: number(v.food, 0, 1e6), wood: number(v.wood, 0, 1e6), stone: number(v.stone, 0, 1e6),
      members: list(v.members, MAX_AGENTS).map(id => number(id, 1, Number.MAX_SAFE_INTEGER, true)),
      buildingQueue: list(v.buildingQueue, 8).map(type => choice(type, ['home', 'storehouse', 'farm', 'sawmill'] as const)),
      knowledge, tech, progress, relations,
    }
  })
  const buildings = data.buildings === undefined ? [] : list(data.buildings, 120).map(raw => {
    const b = object(raw)
    return { id: number(b.id, 1, 10000, true), villageId: number(b.villageId, 1, 1000, true), type: choice(b.type, ['home', 'storehouse', 'farm', 'sawmill'] as const), x: number(b.x, 0, WORLD_W - 1, true), y: number(b.y, 0, WORLD_H - 1, true), progress: number(b.progress, 0, 1) }
  })
  const deaths = data.deaths === undefined ? [] : list(data.deaths, 12).map(raw => {
    const d = object(raw)
    return {
      id: number(d.id, 1, Number.MAX_SAFE_INTEGER - 1, true),
      kind: choice(d.kind, ['human', 'rabbit', 'wolf'] as const),
      x: number(d.x, 0, WORLD_W - 0.000001), y: number(d.y, 0, WORLD_H - 0.000001),
      cause: choice(d.cause, ['hambruna', 'vejez', 'fuego', 'lava', 'ataque', 'frio', 'calor'] as const),
      tick: number(d.tick, 0, 1e12, true),
    }
  })
  const events = data.events === undefined ? [] : list(data.events, 30).map(raw => {
    const e = object(raw)
    return {
      id: number(e.id, 1, Number.MAX_SAFE_INTEGER - 1, true),
      kind: choice(e.kind, ['birth', 'hunt', 'death', 'migration', 'fire', 'rescue', 'flood', 'freeze', 'discovery', 'research', 'founding', 'war', 'raid'] as const),
      x: number(e.x, 0, WORLD_W - 0.000001), y: number(e.y, 0, WORLD_H - 0.000001), tick: number(e.tick, 0, 1e12, true),
      creature: e.creature === undefined ? undefined : choice(e.creature, ['human', 'rabbit', 'wolf'] as const),
      cause: e.cause === undefined ? undefined : choice(e.cause, ['hambruna', 'vejez', 'fuego', 'lava', 'ataque', 'frio', 'calor'] as const),
      label: e.label === undefined ? undefined : String(e.label).slice(0, 40),
      count: number(e.count, 1, 999, true),
    }
  })
  const populationHistory = data.populationHistory === undefined ? [] : list(data.populationHistory, 24).map(raw => {
    const sample = object(raw)
    return { tick: number(sample.tick, 0, 1e12, true), human: number(sample.human, 0, MAX_AGENTS, true), rabbit: number(sample.rabbit, 0, MAX_AGENTS, true), wolf: number(sample.wolf, 0, MAX_AGENTS, true) }
  })
  const fires = list(data.fires, count).map(raw => {
    const f = object(raw)
    const x = number(f.x, 0, WORLD_W - 1, true), y = number(f.y, 0, WORLD_H - 1, true)
    const key = y * WORLD_W + x
    if (firePositions.has(key)) throw new Error('La partida contiene incendios duplicados.')
    firePositions.add(key)
    return { x, y, heat: number(f.heat, 0, 3) }
  })
  const effects = (raw: unknown, limit: number, age: number, radius: number) => list(raw, limit).map(item => {
    const e = object(item)
    return { x: number(e.x, 0, WORLD_W), y: number(e.y, 0, WORLD_H), age: number(e.age, 0, age), radius: number(e.radius, 0, radius) }
  })
  const world = new World(data.seed)
  world.tiles = tiles
  world.vegetation = new Float32Array(vegetation)
  if (data.moisture !== undefined) world.moisture = new Float32Array(list(data.moisture, count, true).map(v => number(v, 0, 100)))
  if (data.fertility !== undefined) world.fertility = new Float32Array(list(data.fertility, count, true).map(v => number(v, 0, 100)))
  if (data.elevation !== undefined) world.elevation = new Float32Array(list(data.elevation, count, true).map(v => number(v, 0, 100)))
  if (data.surfaceWater !== undefined) world.surfaceWater = new Float32Array(list(data.surfaceWater, count, true).map(v => number(v, 0, 100)))
  if (data.weather !== undefined) world.weather = choice(data.weather, ['clear', 'rain', 'drought', 'storm'] as const)
  if (data.weatherUntil !== undefined) world.weatherUntil = number(data.weatherUntil, 0, 1e12, true)
  if (data.windAngle !== undefined) world.windAngle = number(data.windAngle, -100, 100)
  if (data.windStrength !== undefined) world.windStrength = number(data.windStrength, 0, 2)
  world.creatures = creatures
  world.villages = villages
  world.buildings = buildings
  world.deaths = deaths
  world.events = events
  world.populationHistory = populationHistory
  world.fires = fires
  world.meteors = effects(data.meteors, 64, 1, 32)
  world.rainEffects = effects(data.rainEffects, 12, 2, 16)
  world.tick = number(data.tick, 0, 1e12, true)
  world.random.state = number(data.randomState, 0, 0xffffffff, true)
  world.nextId = number(data.nextId, Math.max(0, ...ids, ...events.map(e => e.id)) + 1, Number.MAX_SAFE_INTEGER, true)
  const maxVillageId = villages.reduce((m, v) => Math.max(m, v.id), 0)
  world.nextVillageId = data.nextVillageId === undefined
    ? maxVillageId + 1
    : number(data.nextVillageId, maxVillageId + 1, Number.MAX_SAFE_INTEGER, true)
  world.refreshTemperature()
  world.recount()
  world.spatial.rebuild(world.creatures)
  return world
}
