import { FLAMMABLE, MAX_AGENTS, MAX_AGE, WALKABLE, type Creature, type DeathCause } from './types'
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

function distance2(a: Creature, b: Creature): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

function closest(c: Creature, candidates: Creature[]): Creature | undefined {
  return candidates.sort((a, b) => distance2(c, a) - distance2(c, b))[0]
}

/** Damage always leaves a short visual trace, even when it comes from fire. */
function damage(target: Creature, amount: number): boolean {
  target.life = Math.max(0, target.life - amount)
  target.hurt = Math.max(target.hurt, 0.42)
  return target.life <= 0
}

export function simulate(world: World, dt = STEP): void {
  world.tick++
  world.revision++
  world.spatial.rebuild(world.creatures)
  const burning = new Set(world.fires.map(f => world.index(f.x, f.y)))
  const births: { x: number; y: number }[] = []
  for (const c of world.creatures) {
    if (c.life <= 0) continue
    let deathCause: DeathCause | null = null
    c.age += dt
    c.decisionIn -= dt
    c.breedCooldown = Math.max(0, c.breedCooldown - dt)
    c.attackCooldown = Math.max(0, c.attackCooldown - dt)
    c.hurt = Math.max(0, c.hurt - dt)
    c.energy -= METABOLISM[c.kind] * dt * (c.activity === 'resting' ? 0.5 : 1)
    if (c.energy <= 0) { damage(c, 4 * dt); deathCause = 'hambruna' }
    const tx = Math.floor(c.x), ty = Math.floor(c.y)
    if (burning.has(world.index(tx, ty))) { damage(c, 14 * dt); deathCause = 'fuego' }
    if (world.get(tx, ty) === 'lava') { damage(c, 35 * dt); deathCause = 'lava' }
    if (c.age >= MAX_AGE[c.kind]) { c.life = 0; deathCause = 'vejez' }
    if (c.life <= 0) { world.recordDeath(c, deathCause ?? 'ataque'); continue }

    if (c.decisionIn <= 0) {
      c.decisionIn = 0.45 + world.random.next() * 0.75
      const angle = world.random.next() * Math.PI * 2
      steer(c, Math.cos(angle), Math.sin(angle))
      c.activity = 'exploring'
      const nearby = world.spatial.nearby(c.x, c.y, 7)
      const predator = c.kind === 'rabbit'
        ? closest(c, nearby.filter(o => o.kind === 'wolf' || (o.kind === 'human' && o.energy < 86)))
        : undefined
      if (predator) {
        c.activity = 'fleeing'
        steer(c, c.x - predator.x, c.y - predator.y)
      } else if (burning.has(world.index(tx, ty)) || world.get(tx, ty) === 'lava') {
        c.activity = 'fleeing'
      } else if (c.kind === 'human' && c.energy < FOOD_THRESHOLD.human) {
        const prey = closest(c, nearby.filter(o => o.kind === 'rabbit'))
        c.activity = 'hunting'
        if (prey) steer(c, prey.x - c.x, prey.y - c.y)
        else {
          const food = world.nearestFood(c.x, c.y, 7)
          c.activity = 'seeking-food'
          if (food) steer(c, food.x + 0.5 - c.x, food.y + 0.5 - c.y)
        }
      } else if (c.kind === 'wolf' && c.energy < FOOD_THRESHOLD.wolf) {
        const prey = closest(c, nearby.filter(o => o.kind === 'rabbit' || o.kind === 'human'))
        c.activity = 'hunting'
        if (prey) steer(c, prey.x - c.x, prey.y - c.y)
      } else if (c.kind === 'human') {
        const wolf = closest(c, nearby.filter(o => o.kind === 'wolf' && distance2(c, o) < 2.6))
        if (wolf) {
          c.activity = 'defending'
          steer(c, wolf.x - c.x, wolf.y - c.y)
        }
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

    if (c.kind !== 'wolf' && !['fleeing', 'hunting', 'defending'].includes(c.activity) && c.energy < 96) {
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
    const targets = world.spatial.nearby(c.x, c.y, 0.9).filter(o => o.life > 0 && (
      (c.kind === 'wolf' && c.energy < 94 && (o.kind === 'rabbit' || o.kind === 'human')) ||
      (c.kind === 'human' && o.kind === 'wolf') ||
      (c.kind === 'human' && c.energy < 86 && o.kind === 'rabbit')
    ))
    const target = closest(c, targets)
    let engaged = false
    if (target && c.attackCooldown === 0) {
      engaged = true
      const defending = c.kind === 'human' && target.kind === 'wolf'
      c.activity = defending ? 'defending' : 'hunting'
      c.vx = c.vy = 0
      const fatal = damage(target, c.kind === 'wolf' ? (target.kind === 'human' ? 7 : 10) : (target.kind === 'wolf' ? 8 : 6))
      c.attackCooldown = c.kind === 'wolf' ? 0.72 : 0.82
      if (fatal) {
        world.recordDeath(target, 'ataque')
        c.energy = Math.min(100, c.energy + (c.kind === 'wolf' ? 32 : 24))
        c.activity = 'eating'
        c.decisionIn = Math.min(c.decisionIn, 0.35)
      }
    }

    if (!engaged && c.activity !== 'eating' && c.activity !== 'resting') {
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
