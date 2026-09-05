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
}

export type Activity = 'exploring' | 'seeking-food' | 'eating' | 'hunting' | 'defending' | 'fleeing' | 'resting'
export type Selection = { kind: 'creature'; id: number } | { kind: 'tile'; x: number; y: number } | null
export type GameCommand =
  | { type: 'apply'; tool: ToolId; x: number; y: number; radius: number }
  | { type: 'select'; x: number; y: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: 1 | 2 | 4 }

export const MAX_AGENTS = 300
export const MAX_HEALTH: Record<CreatureKind, number> = { human: 50, rabbit: 20, wolf: 40 }
export const ACTIVITY_NAMES: Record<Activity, string> = {
  exploring: 'Explorando', 'seeking-food': 'Buscando alimento', eating: 'Comiendo',
  hunting: 'Cazando', defending: 'Defendiéndose', fleeing: 'Huyendo del peligro', resting: 'Descansando',
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
