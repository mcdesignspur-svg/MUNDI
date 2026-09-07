import { ObjectPool } from '../core/pool'
import type { EventBus } from '../core/events'
import { sharedPathfinder } from '../core/pathfinding'
import { isAtWar, type FactionState } from './faction'
import type { Village } from '../types'
import type { World } from '../world'

export type CargoKind = 'food' | 'wood' | 'stone'

export interface TradeRoute {
  id: number
  fromId: number
  toId: number
  cargo: CargoKind
  amount: number
  /** Waypoints in tile coords; index 0 = start */
  path: { x: number; y: number }[]
  progress: number
  active: boolean
  disrupted: boolean
  disruptReason?: 'war' | 'monster' | 'terrain' | 'intercept'
}

export interface Caravan {
  id: number
  routeId: number
  x: number
  y: number
  pathIndex: number
  cargo: CargoKind
  amount: number
  alive: boolean
}

export interface TradeState {
  routes: TradeRoute[]
  caravans: Caravan[]
  nextRouteId: number
  nextCaravanId: number
  pool: ObjectPool<Caravan>
}

function resetCaravan(c: Caravan): void {
  c.id = 0
  c.routeId = 0
  c.x = c.y = 0
  c.pathIndex = 0
  c.cargo = 'food'
  c.amount = 0
  c.alive = false
}

export function createTradeState(): TradeState {
  return {
    routes: [],
    caravans: [],
    nextRouteId: 1,
    nextCaravanId: 1,
    pool: new ObjectPool<Caravan>(
      () => ({ id: 0, routeId: 0, x: 0, y: 0, pathIndex: 0, cargo: 'food', amount: 0, alive: false }),
      resetCaravan,
      64,
    ),
  }
}

function surplus(village: Village): CargoKind | null {
  if (village.food > 55) return 'food'
  if (village.wood > 40) return 'wood'
  if (village.stone > 28) return 'stone'
  return null
}

function needs(village: Village, cargo: CargoKind): boolean {
  if (cargo === 'food') return village.food < 28
  if (cargo === 'wood') return village.wood < 16
  return village.stone < 10
}

export function updateTradeRoutes(
  trade: TradeState,
  factions: FactionState,
  bus: EventBus,
  world: World,
  villages: Village[],
): void {
  // Open routes between complementary villages not at war.
  if (world.tick % 40 === 0) {
    for (let i = 0; i < villages.length; i++) {
      for (let j = 0; j < villages.length; j++) {
        if (i === j) continue
        const from = villages[i]!, to = villages[j]!
        if (isAtWar(factions, from.id, to.id)) continue
        const cargo = surplus(from)
        if (!cargo || !needs(to, cargo)) continue
        const existing = trade.routes.find(r => r.active && r.fromId === from.id && r.toId === to.id && r.cargo === cargo)
        if (existing) continue
        if (trade.routes.filter(r => r.active).length >= 12) continue
        const path = sharedPathfinder.findPath(world, from.x, from.y, to.x, to.y, 2200)
        if (!path || path.length < 3) continue
        const amount = cargo === 'food' ? Math.min(10, from.food * 0.12) : cargo === 'wood' ? Math.min(6, from.wood * 0.15) : Math.min(4, from.stone * 0.15)
        if (amount < 1.5) continue
        const route: TradeRoute = {
          id: trade.nextRouteId++,
          fromId: from.id,
          toId: to.id,
          cargo,
          amount,
          path,
          progress: 0,
          active: true,
          disrupted: false,
        }
        trade.routes.push(route)
        bus.emit('route_opened', world.tick, { routeId: route.id, fromId: from.id, toId: to.id })
      }
    }
  }

  // Disrupt routes under war / blocked tiles / predators near path.
  for (const route of trade.routes) {
    if (!route.active) continue
    if (isAtWar(factions, route.fromId, route.toId)) {
      route.disrupted = true
      route.disruptReason = 'war'
      route.active = false
      bus.emit('trade_disrupted', world.tick, { routeId: route.id, reason: 'war' })
      bus.emit('route_closed', world.tick, { routeId: route.id })
      continue
    }
    const mid = route.path[Math.floor(route.path.length / 2)]
    if (mid) {
      const wolves = world.spatial.nearby(mid.x + 0.5, mid.y + 0.5, 5).filter(c => c.kind === 'wolf' && c.life > 0)
      if (wolves.length >= 2 && world.random.next() < 0.08) {
        route.disrupted = true
        route.disruptReason = 'monster'
        route.active = false
        bus.emit('trade_disrupted', world.tick, { routeId: route.id, reason: 'monster' })
        bus.emit('route_closed', world.tick, { routeId: route.id })
        continue
      }
      const cost = sharedPathfinder.findPath(world, route.path[0]!.x, route.path[0]!.y, route.path[route.path.length - 1]!.x, route.path[route.path.length - 1]!.y, 800)
      if (!cost) {
        route.disrupted = true
        route.disruptReason = 'terrain'
        route.active = false
        bus.emit('trade_disrupted', world.tick, { routeId: route.id, reason: 'terrain' })
        bus.emit('route_closed', world.tick, { routeId: route.id })
      }
    }
  }

  // Spawn caravans along active routes.
  if (world.tick % 60 === 0) {
    for (const route of trade.routes) {
      if (!route.active || route.disrupted) continue
      if (trade.caravans.some(c => c.alive && c.routeId === route.id)) continue
      const from = villages.find(v => v.id === route.fromId)
      if (!from) continue
      if (from[route.cargo] < route.amount + 4) continue
      const caravan = trade.pool.acquire()
      if (!caravan) continue
      from[route.cargo] -= route.amount
      caravan.id = trade.nextCaravanId++
      caravan.routeId = route.id
      caravan.x = route.path[0]!.x + 0.5
      caravan.y = route.path[0]!.y + 0.5
      caravan.pathIndex = 0
      caravan.cargo = route.cargo
      caravan.amount = route.amount
      caravan.alive = true
      trade.caravans.push(caravan)
    }
  }

  // Advance caravans along cached path.
  for (let i = trade.caravans.length - 1; i >= 0; i--) {
    const c = trade.caravans[i]!
    if (!c.alive) continue
    const route = trade.routes.find(r => r.id === c.routeId)
    if (!route || !route.active) {
      // Lost cargo → deficit at destination intent.
      const to = villages.find(v => v.id === route?.toId)
      if (to) bus.emit('resource_deficit', world.tick, { villageId: to.id, resource: c.cargo, amount: c.amount })
      c.alive = false
      trade.pool.release(c)
      trade.caravans.splice(i, 1)
      continue
    }
    const next = route.path[Math.min(c.pathIndex + 1, route.path.length - 1)]!
    const dx = next.x + 0.5 - c.x, dy = next.y + 0.5 - c.y
    const dist = Math.hypot(dx, dy) || 1
    const step = 0.55
    if (dist <= step) {
      c.x = next.x + 0.5
      c.y = next.y + 0.5
      c.pathIndex++
      if (c.pathIndex >= route.path.length - 1) {
        const to = villages.find(v => v.id === route.toId)
        if (to) to[c.cargo] += c.amount * 0.92
        c.alive = false
        trade.pool.release(c)
        trade.caravans.splice(i, 1)
      }
    } else {
      c.x += (dx / dist) * step
      c.y += (dy / dist) * step
    }
    // Intercept by enemy raiders or wolves.
    const threats = world.spatial.nearby(c.x, c.y, 1.2).filter(o =>
      (o.kind === 'wolf' && o.life > 0) ||
      (o.kind === 'human' && o.life > 0 && o.villageId && isAtWar(factions, o.villageId, route.fromId)),
    )
    if (threats.length && world.random.next() < 0.25) {
      route.disrupted = true
      route.disruptReason = 'intercept'
      route.active = false
      bus.emit('trade_disrupted', world.tick, { routeId: route.id, reason: 'intercept' })
      const to = villages.find(v => v.id === route.toId)
      if (to) bus.emit('resource_deficit', world.tick, { villageId: to.id, resource: c.cargo, amount: c.amount })
      c.alive = false
      trade.pool.release(c)
      trade.caravans.splice(i, 1)
    }
  }

  // Prune dead routes occasionally.
  if (world.tick % 200 === 0) {
    trade.routes = trade.routes.filter(r => r.active || world.tick - (r.id * 0) < 1e12)
    if (trade.routes.length > 24) trade.routes = trade.routes.filter(r => r.active).slice(-16)
  }
}

export function serializeTrade(trade: TradeState) {
  return {
    nextRouteId: trade.nextRouteId,
    nextCaravanId: trade.nextCaravanId,
    routes: trade.routes.filter(r => r.active).map(r => ({
      id: r.id, fromId: r.fromId, toId: r.toId, cargo: r.cargo, amount: r.amount,
      path: r.path.map(p => ({ x: p.x, y: p.y })), progress: r.progress, active: r.active, disrupted: r.disrupted, disruptReason: r.disruptReason,
    })),
    caravans: trade.caravans.filter(c => c.alive).map(c => ({
      id: c.id, routeId: c.routeId, x: c.x, y: c.y, pathIndex: c.pathIndex, cargo: c.cargo, amount: c.amount, alive: c.alive,
    })),
  }
}

export function restoreTrade(data: ReturnType<typeof serializeTrade> | undefined): TradeState {
  const trade = createTradeState()
  if (!data) return trade
  trade.nextRouteId = data.nextRouteId
  trade.nextCaravanId = data.nextCaravanId
  trade.routes = data.routes.map(r => ({ ...r, path: r.path.map(p => ({ ...p })) }))
  for (const c of data.caravans) {
    const caravan = trade.pool.acquire()
    if (!caravan) continue
    Object.assign(caravan, c, { alive: true })
    trade.caravans.push(caravan)
  }
  return trade
}
