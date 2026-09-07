import { EventBus } from './events'
import { sharedPathfinder } from './pathfinding'
import {
  createFactionState, updateFactionDiplomacy, syncVillageRelations, hydrateFactionState,
  addHostility, isAtWar, hostility, WAR_THRESHOLD, ensureRelation, type FactionState,
} from '../systems/faction'
import { createTradeState, updateTradeRoutes, serializeTrade, restoreTrade, type TradeState } from '../systems/trade'
import { createDynastyState, updateDynasties, serializeDynasty, restoreDynasty, type DynastyState } from '../systems/dynasty'
import {
  createCultureState, ensureCulture, wireCultureEmergence, cultureFriction, religionFriction,
  commemorateCataclysm, serializeCulture, restoreCulture, type CultureState,
} from '../systems/culture'
import { createProphecyState, updateProphecies, serializeProphecies, restoreProphecies, type ProphecyState } from '../systems/prophecy'
import { decideRulerAction, applyRulerPolicy } from '../systems/agentBrain'
import { sharedInfluence } from '../systems/influence'
import type { World } from '../world'
import type { Village } from '../types'

/**
 * Simulation façade: pure tick orchestration separated from presentation.
 * Can run headless / fast-forward without renderer frame coupling.
 */
export class SimulationEngine {
  readonly bus = new EventBus()
  factions: FactionState = createFactionState()
  trade: TradeState = createTradeState()
  dynasty: DynastyState = createDynastyState()
  culture: CultureState = createCultureState()
  prophecy: ProphecyState = createProphecyState()
  private cultureWired = false
  private droughtTicks = 0
  pathCostRevision = -1
  private worldRef: World | null = null

  attach(world: World): void {
    this.worldRef = world
    if (!this.cultureWired) {
      wireCultureEmergence(this.culture, this.bus)
      this.cultureWired = true
      this.bus.on('trade_disrupted', (e) => {
        const world = this.worldRef
        if (!world) return
        const route = this.trade.routes.find(r => r.id === e.payload.routeId)
        if (!route) return
        const village = world.villages.find(v => v.id === route.toId)
        if (village && village.food < 25) {
          this.bus.emit('resource_deficit', world.tick, { villageId: village.id, resource: 'food', amount: 4 })
          village.food = Math.max(0, village.food - 2)
        }
      })
      this.bus.on('resource_deficit', (e) => {
        const world = this.worldRef
        if (!world) return
        if (e.payload.resource === 'food') {
          this.bus.emit('crop_failure', world.tick, { villageId: e.payload.villageId, loss: e.payload.amount })
        }
      })
      this.bus.on('drought', () => { this.droughtTicks++ })
      this.bus.on('marriage_alliance', (e) => {
        addHostility(this.factions, e.payload.a, e.payload.b, -12)
      })
      this.bus.on('war_declared', (e) => {
        const world = this.worldRef
        if (!world) return
        const a = world.villages.find(v => v.id === e.payload.a)
        if (a) world.recordEvent('war', a.x + 0.5, a.y + 0.5, undefined, undefined, e.payload.casus)
      })
      this.bus.on('succession', (e) => {
        const world = this.worldRef
        if (!world) return
        const v = world.villages.find(v => v.id === e.payload.villageId)
        if (v) world.recordEvent('succession', v.x + 0.5, v.y + 0.5, undefined, undefined, e.payload.contested ? 'crisis' : 'herencia')
      })
      this.bus.on('route_opened', (e) => {
        const world = this.worldRef
        if (!world) return
        const from = world.villages.find(v => v.id === e.payload.fromId)
        if (from) world.recordEvent('trade', from.x + 0.5, from.y + 0.5, undefined, undefined, `ruta #${e.payload.routeId}`)
      })
    }
    for (const village of world.villages) ensureCulture(this.culture, village)
  }

  /** Systems tick after core agent/physics update (call once per sim step from simulate). */
  afterAgents(world: World): void {
    this.attach(world)
    if (world.weather === 'drought' && world.tick % 20 === 0) {
      this.bus.emit('drought', world.tick, { severity: this.droughtTicks })
      for (const village of world.villages) {
        if (village.food > 0) {
          const loss = Math.min(village.food, 0.35 + world.random.next() * 0.4)
          village.food = Math.max(0, village.food - loss)
          if (loss > 0.5) this.bus.emit('crop_failure', world.tick, { villageId: village.id, loss })
        }
      }
    }

    if (world.tick % 20 === 0) {
      updateFactionDiplomacy(
        this.factions,
        this.bus,
        world.tick,
        world.villages,
        (a, b) => cultureFriction(this.culture, a, b),
        (a, b) => religionFriction(this.culture, a, b),
      )
      updateDynasties(this.dynasty, this.bus, world.tick, world.villages, world.creatures)
      for (const village of world.villages) {
        ensureCulture(this.culture, village)
        const members = world.creatures.filter(c => c.villageId === village.id && c.life > 0)
        const action = decideRulerAction(this.dynasty, this.factions, village, world.villages, members)
        applyRulerPolicy(village, action)
        this.assignRaiders(world, village, action === 'raid')
      }
      syncVillageRelations(this.factions, world.villages)
    }

    updateTradeRoutes(this.trade, this.factions, this.bus, world, world.villages)

    if (world.tick % 20 === 0) {
      const wars = this.countWars(world.villages)
      updateProphecies(this.prophecy, this.bus, world, wars, (amount) => {
        for (const a of world.villages) for (const b of world.villages) {
          if (a.id >= b.id) continue
          addHostility(this.factions, a.id, b.id, -amount)
        }
        syncVillageRelations(this.factions, world.villages)
      })
    }

    if (world.tick % 30 === 0) {
      sharedInfluence.rebuild(world.width, world.height, world.villages, this.factions)
    }
    if (world.tick % 45 === 0 || this.pathCostRevision < 0) {
      sharedPathfinder.rebuildCostField(world)
      this.pathCostRevision = world.tick
    }

    // Meteor aftermath → dragon mythos for nearest village.
    for (const meteor of world.meteors) {
      if (meteor.age > 0.05 && meteor.age < 0.1) {
        let best: Village | undefined
        let bestD = Infinity
        for (const v of world.villages) {
          const d = Math.hypot(v.x - meteor.x, v.y - meteor.y)
          if (d < bestD) { bestD = d; best = v }
        }
        if (best && bestD < 30) commemorateCataclysm(this.culture, this.bus, world.tick, best.id)
      }
    }
  }

  private assignRaiders(world: World, village: Village, shouldRaid: boolean): void {
    if (!shouldRaid) return
    const enemy = world.villages.find(o => o.id !== village.id && isAtWar(this.factions, village.id, o.id))
    if (!enemy) return
    const members = world.creatures.filter(c => c.villageId === village.id && c.life > 0 && c.task !== 'building')
    const raiders = members.slice(0, Math.min(3, Math.max(1, Math.floor(members.length / 4))))
    for (const r of raiders) {
      r.task = 'raiding'
      r.goalX = enemy.x + 0.5
      r.goalY = enemy.y + 0.5
      r.activity = 'hunting'
    }
    if (raiders.length && world.tick % 40 === 0) {
      this.bus.emit('raid', world.tick, { attackerId: village.id, defenderId: enemy.id })
      world.recordEvent('raid', enemy.x + 0.5, enemy.y + 0.5, undefined, undefined, village.name)
      enemy.food = Math.max(0, enemy.food - 3)
      village.food += 2
    }
  }

  countWars(villages: Village[]): number {
    let n = 0
    for (let i = 0; i < villages.length; i++) {
      for (let j = i + 1; j < villages.length; j++) {
        if (isAtWar(this.factions, villages[i]!.id, villages[j]!.id)) n++
      }
    }
    return n
  }

  onVillageFounded(world: World, village: Village): void {
    ensureCulture(this.culture, village)
    for (const other of world.villages) {
      if (other.id === village.id) continue
      ensureRelation(this.factions, village.id, other.id)
    }
    this.bus.emit('founding', world.tick, { villageId: village.id, x: village.x, y: village.y })
  }

  hostility(a: number, b: number): number { return hostility(this.factions, a, b) }
  atWar(a: number, b: number): boolean { return isAtWar(this.factions, a, b) }
  warThreshold(): number { return WAR_THRESHOLD }

  serialize() {
    return {
      factions: {
        relations: [...this.factions.relations.entries()].map(([id, map]) => [id, [...map.entries()]] as const),
        grievances: this.factions.grievances.map(g => ({ ...g })),
      },
      trade: serializeTrade(this.trade),
      dynasty: serializeDynasty(this.dynasty),
      culture: serializeCulture(this.culture),
      prophecy: serializeProphecies(this.prophecy),
    }
  }

  hydrateFromVillages(villages: Village[]): void {
    this.factions = hydrateFactionState(villages)
  }

  restore(data: ReturnType<SimulationEngine['serialize']> | undefined, villages: Village[]): void {
    if (!data) {
      this.hydrateFromVillages(villages)
      return
    }
    this.factions = createFactionState()
    for (const [id, entries] of data.factions.relations) {
      this.factions.relations.set(id, new Map(entries))
    }
    this.factions.grievances = data.factions.grievances.map(g => ({ ...g }))
    this.trade = restoreTrade(data.trade)
    this.dynasty = restoreDynasty(data.dynasty)
    this.culture = restoreCulture(data.culture)
    this.prophecy = restoreProphecies(data.prophecy)
  }
}

/** Process-wide engine instance used by the browser game and headless scripts. */
export const engine = new SimulationEngine()

/**
 * Fast-forward pure simulation without presentation.
 * Returns final tick after `steps` simulation steps.
 */
export function runHeadless(world: World, steps: number, stepFn: (world: World) => void): number {
  engine.attach(world)
  for (let i = 0; i < steps; i++) stepFn(world)
  return world.tick
}
