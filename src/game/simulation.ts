import { FLAMMABLE, MAX_AGENTS, WALKABLE, type Creature } from './types'
import type { World } from './world'

export const STEP = 1 / 20
const SPEED = { human: 1.6, rabbit: 2.4, wolf: 2.8 }
const METABOLISM = { human: 1.1, rabbit: 1.45, wolf: 1.4 }

function steer(c: Creature, x: number, y: number): void {
  const length = Math.hypot(x, y) || 1
  c.vx = x / length
  c.vy = y / length
}

export function simulate(world: World, dt = STEP): void {
  world.tick++
  world.revision++
  world.spatial.rebuild(world.creatures)
  const burning = new Set(world.fires.map(f => world.index(f.x, f.y)))
  const births: { x: number; y: number }[] = []
  for (const c of world.creatures) {
    if (c.life <= 0) continue
    c.age += dt
    c.decisionIn -= dt
    c.breedCooldown = Math.max(0, c.breedCooldown - dt)
    c.energy -= METABOLISM[c.kind] * dt * (c.activity === 'resting' ? 0.5 : 1)
    if (c.energy <= 0) c.life -= 4 * dt
    const tx = Math.floor(c.x), ty = Math.floor(c.y)
    if (burning.has(world.index(tx, ty))) c.life -= 14 * dt
    if (world.get(tx, ty) === 'lava') c.life -= 35 * dt

    if (c.decisionIn <= 0) {
      c.decisionIn = 0.6 + world.random.next() * 0.4
      const angle = world.random.next() * Math.PI * 2
      steer(c, Math.cos(angle), Math.sin(angle))
      c.activity = 'exploring'
      const nearby = world.spatial.nearby(c.x, c.y, 7)
      const predator = c.kind === 'rabbit' ? nearby.find(o => o.kind === 'wolf') : undefined
      if (predator) {
        c.activity = 'fleeing'
        steer(c, c.x - predator.x, c.y - predator.y)
      } else if (burning.has(world.index(tx, ty)) || world.get(tx, ty) === 'lava') {
        c.activity = 'fleeing'
      } else if (c.kind === 'wolf' && c.energy < 90) {
        const prey = nearby.filter(o => o.kind === 'rabbit').sort((a, b) =>
          (a.x - c.x) ** 2 + (a.y - c.y) ** 2 - (b.x - c.x) ** 2 - (b.y - c.y) ** 2)[0]
        c.activity = 'hunting'
        if (prey) steer(c, prey.x - c.x, prey.y - c.y)
      } else if (c.kind !== 'wolf' && c.energy < 90) {
        const food = world.nearestFood(c.x, c.y, 7)
        c.activity = 'seeking-food'
        if (food) steer(c, food.x + 0.5 - c.x, food.y + 0.5 - c.y)
      } else if (c.energy >= 90) {
        c.activity = 'resting'
        c.vx = c.vy = 0
      }
    }

    if (c.kind !== 'wolf' && c.activity !== 'fleeing' && c.energy < 96) {
      const eaten = world.graze(tx, ty, (c.kind === 'rabbit' ? 11 : 7) * dt)
      c.energy = Math.min(100, c.energy + eaten * 1.8)
      if (eaten > 0) c.activity = 'eating'
    }
    if (c.kind === 'wolf' && c.energy < 94) {
      const prey = world.spatial.nearby(c.x, c.y, 0.8).find(o => o.kind === 'rabbit')
      if (prey) {
        prey.life = 0
        c.energy = Math.min(100, c.energy + 38)
        c.activity = 'eating'
      }
    }

    if (c.activity !== 'eating' && c.activity !== 'resting') {
      const speed = SPEED[c.kind] * dt * (c.activity === 'fleeing' ? 1.35 : 1)
      const nx = c.x + c.vx * speed, ny = c.y + c.vy * speed
      if (world.inBounds(Math.floor(nx), Math.floor(ny)) && WALKABLE.has(world.get(Math.floor(nx), Math.floor(ny)))) {
        c.x = nx; c.y = ny
      } else c.decisionIn = 0
    }

    if (c.kind === 'rabbit' && c.age > 8 && c.energy > 78 && c.breedCooldown === 0 && world.creatures.length + births.length < MAX_AGENTS) {
      const mate = world.spatial.nearby(c.x, c.y, 4).find(o => o.id !== c.id && o.kind === 'rabbit' && o.energy > 58 && o.age > 8)
      if (mate) {
        births.push({ x: tx, y: ty })
        c.energy -= 20
        c.breedCooldown = 14 + world.random.next() * 8
      }
    }
  }
  world.creatures = world.creatures.filter(c => c.life > 0)
  for (const birth of births) world.spawn('rabbit', birth.x, birth.y)
  if (world.tick % 4 === 0) {
    const next: typeof world.fires = []
    for (const fire of world.fires) {
      if (!FLAMMABLE.has(world.get(fire.x, fire.y))) continue
      fire.heat += 0.08
      if (fire.heat > 1.2 && world.get(fire.x, fire.y) !== 'ash') world.set(fire.x, fire.y, 'ash')
      if (world.random.next() < 0.35) {
        const a = Math.floor(world.random.next() * 8) * Math.PI / 4
        const x = fire.x + Math.round(Math.cos(a)), y = fire.y + Math.round(Math.sin(a))
        const key = world.index(x, y)
        if (world.inBounds(x, y) && FLAMMABLE.has(world.get(x, y)) && !burning.has(key)) {
          burning.add(key); next.push({ x, y, heat: 0.2 })
        }
      }
      if (fire.heat < 2.5 && world.random.next() > 0.08) next.push(fire)
      else world.set(fire.x, fire.y, 'ash')
    }
    world.fires = next
  }
  if (world.tick % 20 === 0) world.regrowNature()
  if (world.tick % 90 === 0) {
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i] === 'lava' && world.random.next() < 0.15) world.set(i % world.width, Math.floor(i / world.width), 'ash')
    }
  }
  for (const m of world.meteors) m.age += dt
  world.meteors = world.meteors.filter(m => m.age < 0.9)
  for (const rain of world.rainEffects) rain.age += dt
  world.rainEffects = world.rainEffects.filter(r => r.age < 2)
  world.recount()
  world.spatial.rebuild(world.creatures)
}
