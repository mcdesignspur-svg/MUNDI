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
export type AnimalReason = 'none' | 'danger' | 'fire' | 'water' | 'food' | 'habitat' | 'prey' | 'rest'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Weather = 'clear' | 'rain' | 'drought' | 'storm'
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'
export type Overlay = 'none' | 'food' | 'moisture' | 'fertility' | 'temperature' | 'elevation' | 'hazards'
export type DeathCause = 'hambruna' | 'vejez' | 'fuego' | 'lava' | 'ataque' | 'frio' | 'calor'
export type WorldEventKind = 'birth' | 'hunt' | 'death' | 'migration' | 'fire' | 'rescue' | 'flood' | 'freeze' | 'discovery' | 'research'
export type HumanTask = 'foraging' | 'hunting' | 'lumber' | 'mining' | 'building' | 'fishing' | 'idle'
/** @deprecated Use foraging; kept only for restore compatibility aliases. */
export type LegacyHumanTask = HumanTask | 'gathering'
export type BuildingType = 'home' | 'storehouse' | 'farm' | 'sawmill'

export type KnowledgeId = 'foraging' | 'hunting' | 'fishing' | 'woodcraft' | 'stonecraft' | 'farming' | 'firecraft'
export type TechId = 'wood_tools' | 'stone_tools' | 'farm' | 'sawmill' | 'storehouse'

export interface VillageProgress {
  berries: number
  hunts: number
  fish: number
  trees: number
  stone: number
  nights: number
  farmTicks: number
}

export interface Building { id: number; villageId: number; type: BuildingType; x: number; y: number; progress: number }
export interface Village {
  id: number
  name: string
  x: number
  y: number
  color: string
  food: number
  wood: number
  stone: number
  members: number[]
  buildingQueue: BuildingType[]
  knowledge: KnowledgeId[]
  tech: TechId[]
  progress: VillageProgress
}

export interface DeathRecord {
  id: number
  kind: CreatureKind
  x: number
  y: number
  cause: DeathCause
  tick: number
}

export interface WorldEvent {
  id: number
  kind: WorldEventKind
  x: number
  y: number
  tick: number
  creature?: CreatureKind
  cause?: DeathCause
  /** Knowledge or tech id for discovery/research events. */
  label?: string
  count: number
}

export interface PopulationSample { tick: number; human: number; rabbit: number; wolf: number }

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
  waterEscapeUntil?: number
  villageId?: number
  task?: HumanTask
  /** Seconds spent harvesting at the current goal before delivering. */
  workTimer?: number
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
  frio: 'Murió de frío', calor: 'Murió de calor extremo',
}
export const WORLD_EVENT_NAMES: Record<WorldEventKind, string> = {
  birth: 'Nacimiento', hunt: 'Cacería', death: 'Pérdida', migration: 'Migración', fire: 'Incendio', rescue: 'Salida del agua',
  flood: 'Inundación', freeze: 'Helada', discovery: 'Descubrimiento', research: 'Tecnología',
}
export const SEASON_NAMES: Record<Season, string> = { spring: 'Primavera', summer: 'Verano', autumn: 'Otoño', winter: 'Invierno' }
export const WEATHER_NAMES: Record<Weather, string> = { clear: 'Tiempo estable', rain: 'Lluvia', drought: 'Sequía', storm: 'Tormenta' }
export const DAY_PHASE_NAMES: Record<DayPhase, string> = { dawn: 'Amanecer', day: 'Día', dusk: 'Atardecer', night: 'Noche' }
export const OVERLAY_NAMES: Record<Overlay, string> = {
  none: 'Normal', food: 'Alimento', moisture: 'Humedad', fertility: 'Fertilidad',
  temperature: 'Temperatura', elevation: 'Elevación', hazards: 'Peligros',
}
export const ACTIVITY_NAMES: Record<Activity, string> = {
  exploring: 'Explorando', 'seeking-food': 'Buscando alimento', eating: 'Comiendo',
  hunting: 'Cazando', stalking: 'Acechando', defending: 'Defendiéndose', fleeing: 'Huyendo del peligro', sheltering: 'Buscando refugio', migrating: 'Migrando', resting: 'Descansando', working: 'Trabajando',
}
export const ANIMAL_REASON_NAMES: Record<AnimalReason, string> = {
  none: '', danger: 'peligro cercano', fire: 'fuego o lava', water: 'busca tierra firme', food: 'busca alimento', habitat: 'hábitat agotado', prey: 'busca presas', rest: 'necesita descansar',
}
export const TASK_NAMES: Record<HumanTask, string> = {
  foraging: 'Recolectando bayas', hunting: 'Cazando conejos', lumber: 'Talando árboles', mining: 'Extrayendo piedra',
  building: 'Construyendo', fishing: 'Pescando', idle: 'Sin tarea',
}
export const BUILDING_NAMES: Record<BuildingType, string> = { home: 'Vivienda', storehouse: 'Almacén', farm: 'Granja', sawmill: 'Aserradero' }
export const KNOWLEDGE_NAMES: Record<KnowledgeId, string> = {
  foraging: 'Forrajeo', hunting: 'Caza', fishing: 'Pesca', woodcraft: 'Carpintería',
  stonecraft: 'Cantería', farming: 'Agricultura', firecraft: 'Dominio del fuego',
}
export const TECH_NAMES: Record<TechId, string> = {
  wood_tools: 'Herramientas de madera', stone_tools: 'Herramientas de piedra',
  farm: 'Cultivo', sawmill: 'Aserradero', storehouse: 'Almacén',
}
export const KNOWLEDGE_HINTS: Record<KnowledgeId, string> = {
  foraging: 'Recolecta bayas en praderas y bosques',
  hunting: 'Caza varios conejos para la aldea',
  fishing: 'Pesca en la orilla del agua',
  woodcraft: 'Tala varios árboles',
  stonecraft: 'Extrae piedra de las montañas',
  farming: 'Mantén comida estable junto a tierra fértil',
  firecraft: 'Sobrevive muchas noches en la aldea',
}
export const TECH_HINTS: Record<TechId, string> = {
  wood_tools: 'Requiere carpintería y madera acumulada',
  stone_tools: 'Requiere cantería, herramientas de madera y piedra',
  farm: 'Requiere agricultura y herramientas de madera',
  sawmill: 'Requiere carpintería, herramientas de madera y una vivienda',
  storehouse: 'Requiere herramientas de madera y comida acumulada',
}
/** Comfort band in °C-like units used by metabolism and habitat scoring. */
export const COMFORT: Record<CreatureKind, { min: number; max: number }> = {
  human: { min: 4, max: 34 },
  rabbit: { min: 2, max: 32 },
  wolf: { min: -6, max: 30 },
}

export function emptyProgress(): VillageProgress {
  return { berries: 0, hunts: 0, fish: 0, trees: 0, stone: 0, nights: 0, farmTicks: 0 }
}

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
