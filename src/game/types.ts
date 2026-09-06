export type Biome =
  | 'deepWater'
  | 'water'
  | 'sand'
  | 'grass'
  | 'forest'
  | 'mountain'
  | 'snow'
  | 'ash'
  | 'lava'

export type CreatureKind = 'human' | 'rabbit' | 'wolf'
export type AnimalIntent = 'none' | 'foraging' | 'sheltering' | 'migrating' | 'fleeing' | 'resting' | 'stalking' | 'hunting'
export type AnimalReason = 'none' | 'danger' | 'fire' | 'food' | 'habitat' | 'prey' | 'rest'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Weather = 'clear' | 'rain' | 'drought'
export type Overlay = 'none' | 'food' | 'moisture' | 'fertility' | 'hazards'
export type DeathCause = 'hambruna' | 'vejez' | 'fuego' | 'lava' | 'ataque'
export type HumanTask = 'gathering' | 'lumber' | 'mining' | 'building' | 'idle'
export type BuildingType = 'home' | 'storehouse' | 'farm' | 'sawmill'

export interface Building { id: number; villageId: number; type: BuildingType; x: number; y: number; progress: number }
export interface Village { id: number; name: string; x: number; y: number; color: string; food: number; wood: number; stone: number; members: number[]; buildingQueue: BuildingType[] }

export interface DeathRecord {
  id: number
  kind: CreatureKind
  x: number
  y: number
  cause: DeathCause
  tick: number
}

export type ToolId =
  | 'inspect'
  | 'pan'
  | 'paint-deepWater'
  | 'paint-water'
  | 'paint-sand'
  | 'paint-grass'
  | 'paint-forest'
  | 'paint-mountain'
  | 'paint-snow'
  | 'spawn-human'
  | 'spawn-rabbit'
  | 'spawn-wolf'
  | 'disaster-fire'
  | 'disaster-meteor'
  | 'disaster-rain'

export interface Creature {
  id: number
  kind: CreatureKind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  energy: number
  breedCooldown: number
  age: number
  activity: Activity
  decisionIn: number
  /** Seconds of the red impact flash still visible. */
  hurt: number
  attackCooldown: number
  /** Persisted wildlife decision, also used by the inspector to explain movement. */
  intent?: AnimalIntent
  intentReason?: AnimalReason
  goalX?: number
  goalY?: number
  goalUntil?: number
  villageId?: number
  task?: HumanTask
}

export type Activity = 'exploring' | 'seeking-food' | 'eating' | 'hunting' | 'stalking' | 'defending' | 'fleeing' | 'sheltering' | 'migrating' | 'resting' | 'working'
export type Selection = { kind: 'creature'; id: number } | { kind: 'tile'; x: number; y: number } | null
export type GameCommand =
  | { type: 'apply'; tool: ToolId; x: number; y: number; radius: number }
  | { type: 'select'; x: number; y: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: 1 | 2 | 4 }

export const MAX_AGENTS = 300
export const MAX_HEALTH: Record<CreatureKind, number> = { human: 50, rabbit: 20, wolf: 40 }
export const MAX_AGE: Record<CreatureKind, number> = { human: 1300, rabbit: 520, wolf: 1000 }
export const DEATH_CAUSE_NAMES: Record<DeathCause, string> = {
  hambruna: 'Murió de hambre', vejez: 'Murió de vejez', fuego: 'Murió en un incendio', lava: 'Murió por la lava', ataque: 'Murió en un ataque',
}
export const SEASON_NAMES: Record<Season, string> = { spring: 'Primavera', summer: 'Verano', autumn: 'Otoño', winter: 'Invierno' }
export const WEATHER_NAMES: Record<Weather, string> = { clear: 'Tiempo estable', rain: 'Lluvia', drought: 'Sequía' }
export const OVERLAY_NAMES: Record<Overlay, string> = { none: 'Normal', food: 'Alimento', moisture: 'Humedad', fertility: 'Fertilidad', hazards: 'Peligros' }
export const ACTIVITY_NAMES: Record<Activity, string> = {
  exploring: 'Explorando', 'seeking-food': 'Buscando alimento', eating: 'Comiendo',
  hunting: 'Cazando', stalking: 'Acechando', defending: 'Defendiéndose', fleeing: 'Huyendo del peligro', sheltering: 'Buscando refugio', migrating: 'Migrando', resting: 'Descansando', working: 'Trabajando',
}
export const ANIMAL_REASON_NAMES: Record<AnimalReason, string> = {
  none: '', danger: 'peligro cercano', fire: 'fuego o lava', food: 'busca alimento', habitat: 'hábitat agotado', prey: 'busca presas', rest: 'necesita descansar',
}
export const TASK_NAMES: Record<HumanTask, string> = { gathering: 'Recolectando alimento', lumber: 'Cortando madera', mining: 'Extrayendo piedra', building: 'Construyendo', idle: 'Sin tarea' }
export const BUILDING_NAMES: Record<BuildingType, string> = { home: 'Vivienda', storehouse: 'Almacén', farm: 'Granja', sawmill: 'Aserradero' }

export interface FireCell {
  x: number
  y: number
  heat: number
}

export interface MeteorFx {
  x: number
  y: number
  age: number
  radius: number
}

export const BIOME_COLORS: Record<Biome, string> = {
  deepWater: '#1a4a6e',
  water: '#2f7aad',
  sand: '#d4c08a',
  grass: '#5a9a4a',
  forest: '#2f6b35',
  mountain: '#6e6a66',
  snow: '#e8eef5',
  ash: '#4a4540',
  lava: '#c44a1a',
}

export const CREATURE_COLORS: Record<CreatureKind, string> = {
  human: '#f0c070',
  rabbit: '#e8dcc8',
  wolf: '#8a8f9a',
}

// Ash has no fuel left. Keeping it out of this set prevents a fire from hopping
// indefinitely across land it has already consumed.
export const FLAMMABLE: ReadonlySet<Biome> = new Set(['grass', 'forest'])

export const WALKABLE: ReadonlySet<Biome> = new Set([
  'sand',
  'grass',
  'forest',
  'mountain',
  'snow',
  'ash',
])
