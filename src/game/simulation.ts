import { FLAMMABLE, MAX_AGENTS, WALKABLE, type Creature } from './types'
import { MAX_FIRES, type World } from './world'

export const STEP = 1 / 20
const SPEED = { human: 1.85, rabbit: 3, wolf: 3.25 }
const METABOLISM = { human: 0.58, rabbit: 0.85, wolf: 0.95 }
const FOOD_THRESHOLD = { human: 72, rabbit: 68, wolf: 76 }
const RABBIT_LIMIT = 72

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
      c.decisionIn = 0.45 + world.random.next() * 0.75
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
      } else if (c.kind === 'wolf' && c.energy < FOOD_THRESHOLD.wolf) {
        const prey = nearby.filter(o => o.kind === 'rabbit').sort((a, b) =>
          (a.x - c.x) ** 2 + (a.y - c.y) ** 2 - (b.x - c.x) ** 2 - (b.y - c.y) ** 2)[0]
        c.activity = 'hunting'
        if (prey) steer(c, prey.x - c.x, prey.y - c.y)
      } else if (c.kind !== 'wolf' && c.energy < FOOD_THRESHOLD[c.kind]) {
        const food = world.nearestFood(c.x, c.y, 7)
        c.activity = 'seeking-food'
        if (food) steer(c, food.x + 0.5 - c.x, food.y + 0.5 - c.y)
      } else if (c.energy > 94 && world.random.next() < 0.12) {
        c.activity = 'resting'
        c.vx = c.vy = 0
        c.decisionIn = 0.45 + world.random.next() * 0.55
      }
    }

    if (c.kind !== 'wolf' && c.activity !== 'fleeing' && c.energy < 96) {
      const eaten = world.graze(tx, ty, (c.kind === 'rabbit' ? 5 : 3) * dt)
      c.energy = Math.min(100, c.energy + eaten * 1.25)
      if (eaten > 0) {
        c.activity = 'eating'
        c.vx = c.vy = 0
        // Eating is a short beat in the animation, then the next decision
        // sends the creature on its way again.
        c.decisionIn = Math.min(c.decisionIn, 0.3)
      }
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

    if (c.kind === 'rabbit' && world.population.rabbit + births.length < RABBIT_LIMIT && c.age > 14 && c.energy > 88 && c.breedCooldown === 0 && world.creatures.length + births.length < MAX_AGENTS) {
      const nearbyRabbits = world.spatial.nearby(c.x, c.y, 7).filter(o => o.kind === 'rabbit')
      const mate = nearbyRabbits.find(o => o.id !== c.id && o.energy > 84 && o.age > 14 && o.breedCooldown === 0)
      if (mate && nearbyRabbits.length < 10 && world.random.next() < 0.16) {
        births.push({ x: tx, y: ty })
        c.energy -= 16
        mate.energy -= 10
        // A pair shares one long cooldown, so a crowded group cannot generate
        // a litter every decision cycle.
        c.breedCooldown = mate.breedCooldown = 105 + world.random.next() * 45
      }
    }
  }
  world.creatures = world.creatures.filter(c => c.life > 0)
  for (const birth of births) world.spawn('rabbit', birth.x, birth.y)
  // Fire spreads once per simulated second, needs vegetation as fuel, and can
  // only choose one neighbouring tile. This keeps a blaze meaningful without
  // letting it consume an entire island in a few seconds.
  if (world.tick % 20 === 0) {
    const next: typeof world.fires = []
    for (const fire of world.fires) {
      const biome = world.get(fire.x, fire.y)
      if (!FLAMMABLE.has(biome)) continue
      const fuel = world.burnFuel(fire.x, fire.y, biome === 'forest' ? 7 : 16)
      fire.heat += 0.1
      if (fuel <= 4) {
        world.set(fire.x, fire.y, 'ash')
        continue
      }
      const spreadChance = biome === 'forest' ? 0.12 : 0.035
      if (world.fires.length + next.length < MAX_FIRES && fuel > 25 && world.random.next() < spreadChance) {
        const a = Math.floor(world.random.next() * 8) * Math.PI / 4
        const x = fire.x + Math.round(Math.cos(a)), y = fire.y + Math.round(Math.sin(a))
        const key = world.index(x, y)
        if (world.inBounds(x, y) && FLAMMABLE.has(world.get(x, y)) && world.vegetationAt(x, y) > 30 && !burning.has(key)) {
          burning.add(key); next.push({ x, y, heat: 0.2 })
        }
      }
      next.push(fire)
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
