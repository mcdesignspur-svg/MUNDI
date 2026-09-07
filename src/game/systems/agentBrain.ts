import type { Creature, Village } from '../types'
import type { DynastyState, TraitId } from './dynasty'
import { rulerTraits } from './dynasty'
import { hostility, isAtWar, type FactionState } from './faction'

export type UtilityAction =
  | 'secure_food'
  | 'expand_territory'
  | 'declare_pressure'
  | 'seek_alliance'
  | 'hoard'
  | 'defend'
  | 'raid'

interface ScoredAction {
  action: UtilityAction
  score: number
}

/** Weighted utility AI for notable entities (rulers). Villagers keep FSM/job queues. */
export function decideRulerAction(
  dynasty: DynastyState,
  factions: FactionState,
  village: Village,
  villages: Village[],
  members: Creature[],
): UtilityAction {
  const traits = rulerTraits(dynasty, village.id) ?? { ambition: 0.4, loyalty: 0.5, greed: 0.4, fear: 0.4 }
  const t = (id: TraitId, fallback = 0.4) => traits[id] ?? fallback
  const pop = members.length
  const hungry = village.food < 20
  const threatened = villages.some(o => o.id !== village.id && isAtWar(factions, village.id, o.id))
  const nearestRival = villages
    .filter(o => o.id !== village.id)
    .map(o => ({ o, d: Math.hypot(o.x - village.x, o.y - village.y), h: hostility(factions, village.id, o.id) }))
    .sort((a, b) => a.d - b.d)[0]

  const options: ScoredAction[] = [
    { action: 'secure_food', score: (hungry ? 0.9 : 0.2) + t('fear') * 0.3 + (1 - village.food / 60) * 0.5 },
    { action: 'hoard', score: t('greed') * 0.8 + (village.food > 40 ? 0.35 : 0.1) },
    { action: 'defend', score: (threatened ? 0.85 : 0.15) + t('fear') * 0.45 + t('loyalty') * 0.2 },
    { action: 'expand_territory', score: t('ambition') * 0.7 + (pop > 10 ? 0.35 : 0.05) - (hungry ? 0.4 : 0) },
    { action: 'seek_alliance', score: t('loyalty') * 0.55 + t('compassion', 0.4) * 0.35 + (threatened ? 0.3 : 0) - t('wrath', 0.3) * 0.4 },
    {
      action: 'raid',
      score: (nearestRival && nearestRival.h > 40 ? 0.5 : 0.05)
        + t('wrath', 0.3) * 0.55
        + t('ambition') * 0.35
        + (hungry ? 0.35 : 0)
        - t('compassion', 0.4) * 0.4,
    },
    {
      action: 'declare_pressure',
      score: (nearestRival && nearestRival.d < 20 ? 0.4 : 0.1) + t('ambition') * 0.4 + t('wrath', 0.3) * 0.3,
    },
  ]

  options.sort((a, b) => b.score - a.score)
  return options[0]?.action ?? 'secure_food'
}

/** Apply soft effects of the ruler decision onto village task weights / food posture. */
export function applyRulerPolicy(village: Village, action: UtilityAction): void {
  if (action === 'secure_food' || action === 'hoard') {
    // Bias queues toward food infrastructure when possible.
    if (!village.buildingQueue.includes('farm') && village.tech.includes('farm')) {
      village.buildingQueue.unshift('farm')
    }
    if (!village.buildingQueue.includes('storehouse') && village.tech.includes('storehouse')) {
      village.buildingQueue.unshift('storehouse')
    }
  }
  if (action === 'expand_territory' && !village.buildingQueue.includes('home')) {
    village.buildingQueue.push('home')
  }
}
