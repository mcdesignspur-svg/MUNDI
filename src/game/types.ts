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
  age: number
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

export const BIOME_LABELS: Record<Biome, string> = {
  deepWater: 'Océano',
  water: 'Agua',
  sand: 'Arena',
  grass: 'Hierba',
  forest: 'Bosque',
  mountain: 'Montaña',
  snow: 'Nieve',
  ash: 'Ceniza',
  lava: 'Lava',
}

export const CREATURE_COLORS: Record<CreatureKind, string> = {
  human: '#f0c070',
  rabbit: '#e8dcc8',
  wolf: '#8a8f9a',
}

export const FLAMMABLE: ReadonlySet<Biome> = new Set(['grass', 'forest', 'ash'])

export const WALKABLE: ReadonlySet<Biome> = new Set([
  'sand',
  'grass',
  'forest',
  'mountain',
  'snow',
  'ash',
])
