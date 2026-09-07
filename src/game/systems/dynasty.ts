import type { EventBus } from '../core/events'
import type { Creature, Village } from '../types'

export type TraitId = 'ambition' | 'loyalty' | 'greed' | 'fear' | 'wrath' | 'compassion'

export interface Noble {
  creatureId: number
  villageId: number
  role: 'ruler' | 'heir' | 'consort' | 'claimant'
  traits: Partial<Record<TraitId, number>>
  claimStrength: number
}

export interface DynastyState {
  nobles: Noble[]
  /** villageId → current ruler creatureId */
  rulers: Map<number, number>
  marriages: { aVillage: number; bVillage: number; tick: number }[]
}

export function createDynastyState(): DynastyState {
  return { nobles: [], rulers: new Map(), marriages: [] }
}

function traitsFromSeed(seed: number): Partial<Record<TraitId, number>> {
  const n = (offset: number) => ((Math.sin(seed * 12.9898 + offset) * 43758.5453) % 1 + 1) % 1
  return {
    ambition: 0.25 + n(1) * 0.7,
    loyalty: 0.2 + n(2) * 0.75,
    greed: 0.15 + n(3) * 0.7,
    fear: 0.1 + n(4) * 0.65,
    wrath: 0.1 + n(5) * 0.7,
    compassion: 0.15 + n(6) * 0.7,
  }
}

export function ensureRuler(state: DynastyState, village: Village, members: Creature[]): Noble | undefined {
  const living = members.filter(c => c.life > 0 && c.kind === 'human')
  if (!living.length) {
    state.rulers.delete(village.id)
    state.nobles = state.nobles.filter(n => n.villageId !== village.id)
    return undefined
  }
  let rulerId = state.rulers.get(village.id)
  let ruler = living.find(c => c.id === rulerId)
  if (!ruler) {
    ruler = [...living].sort((a, b) => b.age - a.age || b.energy - a.energy)[0]
    if (!ruler) return undefined
    state.rulers.set(village.id, ruler.id)
    state.nobles = state.nobles.filter(n => !(n.villageId === village.id && n.role === 'ruler'))
    const noble: Noble = {
      creatureId: ruler.id,
      villageId: village.id,
      role: 'ruler',
      traits: traitsFromSeed(ruler.id * 17 + village.id),
      claimStrength: 1,
    }
    state.nobles.push(noble)
    appointHeir(state, village, living, ruler.id)
    return noble
  }
  appointHeir(state, village, living, ruler.id)
  return state.nobles.find(n => n.creatureId === ruler!.id && n.role === 'ruler')
}

function appointHeir(state: DynastyState, village: Village, living: Creature[], rulerId: number): void {
  const existing = state.nobles.find(n => n.villageId === village.id && n.role === 'heir')
  if (existing && living.some(c => c.id === existing.creatureId)) return
  state.nobles = state.nobles.filter(n => !(n.villageId === village.id && n.role === 'heir'))
  const candidates = living.filter(c => c.id !== rulerId).sort((a, b) => a.age - b.age)
  const heir = candidates.find(c => c.age < 80) ?? candidates[0]
  if (!heir) return
  state.nobles.push({
    creatureId: heir.id,
    villageId: village.id,
    role: 'heir',
    traits: traitsFromSeed(heir.id * 31 + village.id),
    claimStrength: 0.75,
  })
}

export function updateDynasties(
  state: DynastyState,
  bus: EventBus,
  tick: number,
  villages: Village[],
  creatures: Creature[],
): void {
  for (const village of villages) {
    const members = creatures.filter(c => c.villageId === village.id && c.life > 0)
    const previousRuler = state.rulers.get(village.id)
    const rulerAlive = previousRuler !== undefined && members.some(c => c.id === previousRuler)
    if (previousRuler !== undefined && !rulerAlive) {
      const heir = state.nobles.find(n => n.villageId === village.id && n.role === 'heir' && members.some(c => c.id === n.creatureId))
      const claimants = state.nobles.filter(n => n.villageId === village.id && n.role === 'claimant' && members.some(c => c.id === n.creatureId))
      const contested = claimants.some(c => c.claimStrength > 0.55) || (heir?.traits.ambition ?? 0) > 0.75 && (heir?.traits.loyalty ?? 1) < 0.4
      if (heir) {
        state.rulers.set(village.id, heir.creatureId)
        for (const n of state.nobles) {
          if (n.villageId === village.id && n.role === 'ruler') n.role = 'claimant'
          if (n.creatureId === heir.creatureId) { n.role = 'ruler'; n.claimStrength = 1 }
        }
        bus.emit('succession', tick, { villageId: village.id, rulerId: heir.creatureId, contested })
        if (contested) bus.emit('civil_war', tick, { villageId: village.id })
      } else {
        ensureRuler(state, village, members)
        const next = state.rulers.get(village.id)
        if (next) bus.emit('succession', tick, { villageId: village.id, rulerId: next, contested: false })
      }
    } else {
      ensureRuler(state, village, members)
    }
  }

  // Dynastic marriage alliances when both have heirs and low hostility opportunity.
  if (tick % 120 === 0) {
    for (let i = 0; i < villages.length; i++) {
      for (let j = i + 1; j < villages.length; j++) {
        const a = villages[i]!, b = villages[j]!
        if (state.marriages.some(m => (m.aVillage === a.id && m.bVillage === b.id) || (m.aVillage === b.id && m.bVillage === a.id))) continue
        const heirA = state.nobles.find(n => n.villageId === a.id && n.role === 'heir')
        const heirB = state.nobles.find(n => n.villageId === b.id && n.role === 'heir')
        if (!heirA || !heirB) continue
        if ((heirA.traits.ambition ?? 0) > 0.7 && (heirB.traits.ambition ?? 0) > 0.7) continue
        if (a.food > 30 && b.food > 30 && ((tick * 17 + a.id * 13 + b.id) % 100) < 12) {
          state.marriages.push({ aVillage: a.id, bVillage: b.id, tick })
          bus.emit('marriage_alliance', tick, { a: a.id, b: b.id })
        }
      }
    }
  }
}

export function rulerTraits(state: DynastyState, villageId: number): Partial<Record<TraitId, number>> | undefined {
  const id = state.rulers.get(villageId)
  if (!id) return undefined
  return state.nobles.find(n => n.creatureId === id)?.traits
}

export function serializeDynasty(state: DynastyState) {
  return {
    nobles: state.nobles.map(n => ({ ...n, traits: { ...n.traits } })),
    rulers: [...state.rulers.entries()],
    marriages: state.marriages.map(m => ({ ...m })),
  }
}

export function restoreDynasty(data: ReturnType<typeof serializeDynasty> | undefined): DynastyState {
  const state = createDynastyState()
  if (!data) return state
  state.nobles = data.nobles.map(n => ({ ...n, traits: { ...n.traits } }))
  state.rulers = new Map(data.rulers)
  state.marriages = data.marriages.map(m => ({ ...m }))
  return state
}
