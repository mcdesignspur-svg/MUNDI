import type { EventBus } from '../core/events'
import type { World } from '../world'

export type ProphecyCondition =
  | { type: 'drought'; minTicks?: number }
  | { type: 'village_food_below'; threshold: number }
  | { type: 'war_count_at_least'; count: number }
  | { type: 'temperature_below'; celsius: number }
  | { type: 'population_below'; kind: 'human' | 'rabbit' | 'wolf'; count: number }
  | { type: 'fires_at_least'; count: number }

export type ProphecyAction =
  | { type: 'bless_fertility'; amount: number }
  | { type: 'curse_heat'; amount: number }
  | { type: 'rain_blessing'; radius: number }
  | { type: 'spawn_food_burst' }
  | { type: 'calm_hostility'; amount: number }
  | { type: 'ignite_drylands' }

export interface Prophecy {
  id: string
  name: string
  condition: ProphecyCondition
  action: ProphecyAction
  cooldownTicks: number
  lastFired: number
  enabled: boolean
}

export interface ProphecyState {
  rules: Prophecy[]
}

export function createProphecyState(): ProphecyState {
  return {
    rules: [
      {
        id: 'rain_after_drought',
        name: 'Lluvia después de la sequía',
        condition: { type: 'drought' },
        action: { type: 'rain_blessing', radius: 6 },
        cooldownTicks: 400,
        lastFired: -1e9,
        enabled: true,
      },
      {
        id: 'famine_mercy',
        name: 'Misericordia ante el hambre',
        condition: { type: 'village_food_below', threshold: 6 },
        action: { type: 'spawn_food_burst' },
        cooldownTicks: 500,
        lastFired: -1e9,
        enabled: true,
      },
      {
        id: 'war_fatigue',
        name: 'Cansancio de guerra',
        condition: { type: 'war_count_at_least', count: 1 },
        action: { type: 'calm_hostility', amount: 8 },
        cooldownTicks: 600,
        lastFired: -1e9,
        enabled: true,
      },
      {
        id: 'deep_freeze',
        name: 'Helada profunda',
        condition: { type: 'temperature_below', celsius: -4 },
        action: { type: 'curse_heat', amount: -3 },
        cooldownTicks: 350,
        lastFired: -1e9,
        enabled: true,
      },
      {
        id: 'dry_spark',
        name: 'Chispa en la sequía',
        condition: { type: 'fires_at_least', count: 8 },
        action: { type: 'bless_fertility', amount: 4 },
        cooldownTicks: 450,
        lastFired: -1e9,
        enabled: true,
      },
    ],
  }
}

function conditionMet(rule: Prophecy, world: World, warCount: number): boolean {
  const c = rule.condition
  if (c.type === 'drought') return world.weather === 'drought'
  if (c.type === 'village_food_below') return world.villages.some(v => v.food < c.threshold)
  if (c.type === 'war_count_at_least') return warCount >= c.count
  if (c.type === 'temperature_below') {
    let cold = 0
    for (let i = 0; i < world.temperature.length; i += 17) if (world.temperature[i]! < c.celsius) cold++
    return cold > 20
  }
  if (c.type === 'population_below') return world.population[c.kind] < c.count
  if (c.type === 'fires_at_least') return world.fires.length >= c.count
  return false
}

function applyAction(action: ProphecyAction, world: World, onCalm?: (amount: number) => void): void {
  if (action.type === 'rain_blessing') {
    const v = world.villages[0]
    if (v) world.rain(v.x, v.y, action.radius)
    else world.rain(world.width >> 1, world.height >> 1, action.radius)
  } else if (action.type === 'spawn_food_burst') {
    for (const village of world.villages) {
      if (village.food < 12) {
        village.food += 14
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = village.x + dx, y = village.y + dy
          if (world.inBounds(x, y) && (world.get(x, y) === 'grass' || world.get(x, y) === 'forest')) {
            world.vegetation[world.index(x, y)] = Math.min(100, world.vegetation[world.index(x, y)]! + 18)
            world.fertility[world.index(x, y)] = Math.min(100, world.fertility[world.index(x, y)]! + 6)
          }
        }
      }
    }
  } else if (action.type === 'bless_fertility') {
    for (let i = 0; i < world.fertility.length; i++) {
      if (world.tiles[i] === 'grass' || world.tiles[i] === 'forest') {
        world.fertility[i] = Math.min(100, world.fertility[i]! + action.amount)
      }
    }
  } else if (action.type === 'curse_heat') {
    for (let i = 0; i < world.temperature.length; i++) {
      world.temperature[i] = Math.max(-12, Math.min(46, world.temperature[i]! + action.amount))
    }
  } else if (action.type === 'calm_hostility') {
    onCalm?.(action.amount)
  } else if (action.type === 'ignite_drylands') {
    for (let y = 4; y < world.height - 4; y += 7) for (let x = 4; x < world.width - 4; x += 7) {
      if (world.moistureAt(x, y) < 20 && world.get(x, y) === 'grass') world.ignite(x, y, 0)
    }
  }
}

export function updateProphecies(
  state: ProphecyState,
  bus: EventBus,
  world: World,
  warCount: number,
  onCalmHostility?: (amount: number) => void,
): void {
  for (const rule of state.rules) {
    if (!rule.enabled) continue
    if (world.tick - rule.lastFired < rule.cooldownTicks) continue
    if (!conditionMet(rule, world, warCount)) continue
    applyAction(rule.action, world, onCalmHostility)
    rule.lastFired = world.tick
    bus.emit('prophecy_fired', world.tick, { id: rule.id, action: rule.action.type })
    world.recordEvent('prophecy', world.width / 2, world.height / 2, undefined, undefined, rule.name)
  }
}

export function addProphecy(state: ProphecyState, rule: Prophecy): void {
  state.rules.push(rule)
}

export function serializeProphecies(state: ProphecyState) {
  return state.rules.map(r => ({ ...r }))
}

export function restoreProphecies(data: ReturnType<typeof serializeProphecies> | undefined): ProphecyState {
  const state = createProphecyState()
  if (!data) return state
  state.rules = data.map(r => ({ ...r }))
  return state
}
