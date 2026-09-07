import type { EventBus, SimEvent } from '../core/events'
import type { Village } from '../types'

export type BeliefId =
  | 'dragon_slayers'
  | 'river_keepers'
  | 'fire_wardens'
  | 'harvest_faith'
  | 'wolf_bane'
  | 'sky_watchers'
  | 'ancestor_cult'
  | 'stone_kin'

export interface CultureProfile {
  villageId: number
  beliefs: Partial<Record<BeliefId, number>>
  traditions: string[]
  /** Cultural identity hash for friction calc */
  ethos: number
}

export interface CultureState {
  profiles: Map<number, CultureProfile>
}

export function createCultureState(): CultureState {
  return { profiles: new Map() }
}

export function ensureCulture(state: CultureState, village: Village): CultureProfile {
  let profile = state.profiles.get(village.id)
  if (!profile) {
    profile = {
      villageId: village.id,
      beliefs: { harvest_faith: 0.35, ancestor_cult: 0.25 },
      traditions: ['foraging'],
      ethos: (village.id * 2654435761) >>> 0,
    }
    state.profiles.set(village.id, profile)
  }
  return profile
}

function bump(profile: CultureProfile, belief: BeliefId, amount: number, tradition?: string): void {
  profile.beliefs[belief] = Math.max(0, Math.min(1, (profile.beliefs[belief] ?? 0) + amount))
  if (tradition && !profile.traditions.includes(tradition)) {
    profile.traditions.push(tradition)
    if (profile.traditions.length > 8) profile.traditions.shift()
  }
  profile.ethos = (profile.ethos + Math.floor(amount * 1000) * 17) >>> 0
}

/** Subscribe once: world events reshape belief sets (dragon-slaying mythos, etc.). */
export function wireCultureEmergence(state: CultureState, bus: EventBus): () => void {
  return bus.onAny((event: SimEvent) => {
    if (event.kind === 'fire') {
      for (const profile of state.profiles.values()) bump(profile, 'fire_wardens', 0.04, 'firecraft_myth')
    } else if (event.kind === 'flood') {
      for (const profile of state.profiles.values()) bump(profile, 'river_keepers', 0.05, 'flood_memory')
    } else if (event.kind === 'freeze') {
      for (const profile of state.profiles.values()) bump(profile, 'sky_watchers', 0.04, 'winter_vigil')
    } else if (event.kind === 'war_declared') {
      const a = state.profiles.get(event.payload.a)
      const b = state.profiles.get(event.payload.b)
      if (a) bump(a, 'wolf_bane', 0.06, 'martial_rite')
      if (b) bump(b, 'wolf_bane', 0.06, 'martial_rite')
    } else if (event.kind === 'crop_failure') {
      const p = state.profiles.get(event.payload.villageId)
      if (p) bump(p, 'harvest_faith', 0.08, 'famine_oath')
    } else if (event.kind === 'succession' && event.payload.contested) {
      const p = state.profiles.get(event.payload.villageId)
      if (p) bump(p, 'ancestor_cult', 0.07, 'blood_claim')
    } else if (event.kind === 'founding') {
      ensureCulture(state, { id: event.payload.villageId } as Village)
      const p = state.profiles.get(event.payload.villageId)
      if (p) bump(p, 'stone_kin', 0.05, 'foundation')
    }
  })
}

export function cultureFriction(state: CultureState, a: number, b: number): number {
  const pa = state.profiles.get(a), pb = state.profiles.get(b)
  if (!pa || !pb) return 0
  let friction = 0
  const keys = new Set([...Object.keys(pa.beliefs), ...Object.keys(pb.beliefs)]) as Set<BeliefId>
  for (const key of keys) {
    friction += Math.abs((pa.beliefs[key] ?? 0) - (pb.beliefs[key] ?? 0))
  }
  return Math.min(1.5, friction * 0.35)
}

export function religionFriction(state: CultureState, a: number, b: number): number {
  const pa = state.profiles.get(a), pb = state.profiles.get(b)
  if (!pa || !pb) return 0
  const dominant = (p: CultureProfile) =>
    (Object.entries(p.beliefs) as [BeliefId, number][]).sort((x, y) => y[1] - x[1])[0]?.[0]
  const da = dominant(pa), db = dominant(pb)
  if (!da || !db) return 0
  if (da === db) return -0.15
  // Martial vs harvest faiths clash harder.
  if ((da === 'wolf_bane' || da === 'dragon_slayers') && (db === 'harvest_faith' || db === 'river_keepers')) return 0.55
  if ((db === 'wolf_bane' || db === 'dragon_slayers') && (da === 'harvest_faith' || da === 'river_keepers')) return 0.55
  return 0.25
}

/** Meteor / lava survival → dragon-slaying mythos for nearest village. */
export function commemorateCataclysm(state: CultureState, bus: EventBus, tick: number, villageId: number): void {
  const p = state.profiles.get(villageId)
  if (!p) return
  bump(p, 'dragon_slayers', 0.2, 'meteor_survivors')
  bus.emit('culture_shift', tick, { villageId, trait: 'dragon_slayers' })
}

export function serializeCulture(state: CultureState) {
  return [...state.profiles.values()].map(p => ({
    villageId: p.villageId,
    beliefs: { ...p.beliefs },
    traditions: [...p.traditions],
    ethos: p.ethos,
  }))
}

export function restoreCulture(data: ReturnType<typeof serializeCulture> | undefined): CultureState {
  const state = createCultureState()
  if (!data) return state
  for (const p of data) {
    state.profiles.set(p.villageId, {
      villageId: p.villageId,
      beliefs: { ...p.beliefs },
      traditions: [...p.traditions],
      ethos: p.ethos,
    })
  }
  return state
}
