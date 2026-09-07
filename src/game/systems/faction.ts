import type { EventBus, CasusBelli } from '../core/events'
import type { Village } from '../types'

export const WAR_THRESHOLD = 55
export const MAX_VILLAGES = 8
export const MIN_FOUND_DISTANCE = 18

export function relationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

export interface FactionState {
  /** Hostility 0–100 keyed by villageId → otherId */
  relations: Map<number, Map<number, number>>
  /** Accumulated casus belli explanations */
  grievances: { fromId: number; toId: number; kind: CasusBelli; amount: number; tick: number }[]
}

export function createFactionState(): FactionState {
  return { relations: new Map(), grievances: [] }
}

export function ensureRelation(state: FactionState, a: number, b: number): void {
  if (a === b) return
  if (!state.relations.has(a)) state.relations.set(a, new Map())
  if (!state.relations.has(b)) state.relations.set(b, new Map())
  if (!state.relations.get(a)!.has(b)) state.relations.get(a)!.set(b, 0)
  if (!state.relations.get(b)!.has(a)) state.relations.get(b)!.set(a, 0)
}

export function hostility(state: FactionState, a: number, b: number): number {
  return state.relations.get(a)?.get(b) ?? 0
}

export function isAtWar(state: FactionState, a: number, b: number): boolean {
  return hostility(state, a, b) >= WAR_THRESHOLD
}

export function addHostility(state: FactionState, a: number, b: number, amount: number): number {
  ensureRelation(state, a, b)
  const next = Math.max(0, Math.min(100, hostility(state, a, b) + amount))
  state.relations.get(a)!.set(b, next)
  state.relations.get(b)!.set(a, Math.max(0, Math.min(100, hostility(state, b, a) + amount * 0.85)))
  return next
}

export function recordGrievance(
  state: FactionState,
  bus: EventBus,
  tick: number,
  fromId: number,
  toId: number,
  kind: CasusBelli,
  amount: number,
): void {
  if (amount <= 0 || fromId === toId) return
  state.grievances.push({ fromId, toId, kind, amount, tick })
  if (state.grievances.length > 48) state.grievances.shift()
  const before = hostility(state, fromId, toId)
  const after = addHostility(state, fromId, toId, amount)
  bus.emit('grievance', tick, { fromId, toId, kind, amount })
  if (before < WAR_THRESHOLD && after >= WAR_THRESHOLD) {
    bus.emit('war_declared', tick, { a: fromId, b: toId, casus: kind })
  }
}

/** Tick diplomacy: scarcity, proximity, cultural friction → hostility; peace decays. */
export function updateFactionDiplomacy(
  state: FactionState,
  bus: EventBus,
  tick: number,
  villages: Village[],
  cultureFriction: (a: number, b: number) => number,
  religionFriction: (a: number, b: number) => number,
): void {
  for (let i = 0; i < villages.length; i++) {
    for (let j = i + 1; j < villages.length; j++) {
      const a = villages[i]!, b = villages[j]!
      ensureRelation(state, a.id, b.id)
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      let delta = -0.08
      if (dist < 22) delta += (22 - dist) * 0.12
      if (a.food < 18 || b.food < 18) delta += 0.85
      if (a.food < 8 || b.food < 8) delta += 1.35
      if (a.food < 4 || b.food < 4) delta += 1.1
      delta += cultureFriction(a.id, b.id) * 0.35
      delta += religionFriction(a.id, b.id) * 0.4
      if (delta > 0.2) {
        const kind: CasusBelli = a.food < 12 || b.food < 12
          ? 'resource_starvation'
          : dist < 16
            ? 'border_friction'
            : cultureFriction(a.id, b.id) > religionFriction(a.id, b.id)
              ? 'cultural_resentment'
              : 'religious_rivalry'
        recordGrievance(state, bus, tick, a.id, b.id, kind, delta)
      } else {
        addHostility(state, a.id, b.id, delta)
        if (hostility(state, a.id, b.id) < WAR_THRESHOLD * 0.45 && hostility(state, a.id, b.id) + delta < WAR_THRESHOLD * 0.4) {
          // Soft peace signal when hostility falls far below war.
        }
      }
    }
  }
}

export function syncVillageRelations(state: FactionState, villages: Village[]): void {
  for (const village of villages) {
    const map = state.relations.get(village.id)
    village.relations = {}
    if (!map) continue
    for (const [other, value] of map) village.relations[other] = value
  }
}

export function hydrateFactionState(villages: Village[]): FactionState {
  const state = createFactionState()
  for (const village of villages) {
    for (const [other, value] of Object.entries(village.relations ?? {})) {
      const oid = Number(other)
      ensureRelation(state, village.id, oid)
      state.relations.get(village.id)!.set(oid, value)
    }
  }
  return state
}

export const VILLAGE_STYLES = [
  { name: 'Aldea del Roble', color: '#e7bd66' },
  { name: 'Poblado del Río', color: '#7eb8d4' },
  { name: 'Colina del Lobo', color: '#c48a6a' },
  { name: 'Valle Verde', color: '#8fc47a' },
  { name: 'Pico de Piedra', color: '#a8a09a' },
  { name: 'Bahía Serena', color: '#6ec1b0' },
  { name: 'Bosque Ámbar', color: '#d4a04a' },
  { name: 'Llanura Norte', color: '#b8a0c8' },
] as const
