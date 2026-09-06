import { FLAMMABLE, MAX_AGENTS, MAX_AGE, WALKABLE, type Activity, type AnimalIntent, type AnimalReason, type Creature, type DeathCause } from './types'
import { MAX_FIRES, type World } from './world'

export const STEP = 1 / 20
const SPEED = { human: 1.85, rabbit: 3.35, wolf: 2.9 }
const METABOLISM = { human: 0.58, rabbit: 0.85, wolf: 0.95 }
const FOOD_THRESHOLD = { human: 72, rabbit: 68, wolf: 76 }
const RABBIT_LIMIT = 72
const VILLAGE_SAFE_RADIUS = 10

function steer(c: Creature, x: number, y: number): void {
  const length = Math.hypot(x, y) || 1
  c.vx = x / length
  c.vy = y / length
}

function distance2(a: Creature, b: Creature): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 }
function distanceTo(c: Creature, x: number, y: number): number { return Math.hypot(c.x - x, c.y - y) }
function closest(c: Creature, candidates: Creature[]): Creature | undefined {
  let best: Creature | undefined
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = distance2(c, candidate)
    if (distance < bestDistance) { best = candidate; bestDistance = distance }
  }
  return best
}

function activityFor(intent: AnimalIntent): Activity {
  return intent === 'foraging' ? 'seeking-food'
    : intent === 'sheltering' ? 'sheltering'
      : intent === 'migrating' ? 'migrating'
        : intent === 'fleeing' ? 'fleeing'
          : intent === 'stalking' ? 'stalking'
            : intent === 'hunting' ? 'hunting'
              : intent === 'resting' ? 'resting' : 'exploring'
}

function setAnimalGoal(c: Creature, intent: AnimalIntent, reason: AnimalReason, x?: number, y?: number, until = 0): void {
  c.intent = intent
  c.intentReason = reason
  c.goalX = x
  c.goalY = y
  c.goalUntil = until
  c.activity = activityFor(intent)
  if (x !== undefined && y !== undefined) steer(c, x - c.x, y - c.y)
  else if (intent === 'resting') c.vx = c.vy = 0
}

function clearAnimalGoal(c: Creature): void { setAnimalGoal(c, 'none', 'none') }
function goalActive(world: World, c: Creature): boolean {
  return c.goalX !== undefined && c.goalY !== undefined && (c.goalUntil ?? 0) > world.tick && distanceTo(c, c.goalX, c.goalY) > 1.25
}

function nearestHazard(world: World, c: Creature, radius = 7): { x: number; y: number } | undefined {
  let best: { x: number; y: number } | undefined
  let bestDistance = radius * radius
  for (const fire of world.fires) {
    const d = (fire.x + 0.5 - c.x) ** 2 + (fire.y + 0.5 - c.y) ** 2
    if (d < bestDistance) { bestDistance = d; best = { x: fire.x + 0.5, y: fire.y + 0.5 } }
  }
  const tx = Math.floor(c.x), ty = Math.floor(c.y)
  if (world.get(tx, ty) === 'lava') return { x: tx + 0.5, y: ty + 0.5 }
  return best
}

function rabbitHabitatPoor(world: World, c: Creature): boolean {
  const x = Math.floor(c.x), y = Math.floor(c.y)
  return world.vegetationAt(x, y) < 18 || world.moistureAt(x, y) < 28 || !world.nearestFood(c.x, c.y, 8)
}

function decideRabbit(world: World, c: Creature): void {
  const nearby = world.spatial.nearby(c.x, c.y, 9)
  const predator = closest(c, nearby.filter(o => o.life > 0 && (o.kind === 'wolf' || (o.kind === 'human' && !o.villageId && o.energy < 82))))
  const hazard = nearestHazard(world, c)
  if (hazard) {
    setAnimalGoal(c, 'fleeing', 'fire', c.x + (c.x - hazard.x) * 3, c.y + (c.y - hazard.y) * 3, world.tick + 20 * 4)
    return
  }
  if (predator) {
    const cover = world.nearestBiome(c.x, c.y, 'forest', 10)
    if (cover && Math.hypot(cover.x + 0.5 - predator.x, cover.y + 0.5 - predator.y) > Math.hypot(c.x - predator.x, c.y - predator.y) + 1) {
      setAnimalGoal(c, 'sheltering', 'danger', cover.x + 0.5, cover.y + 0.5, world.tick + 20 * 8)
    } else {
      setAnimalGoal(c, 'fleeing', 'danger', c.x + (c.x - predator.x) * 4, c.y + (c.y - predator.y) * 4, world.tick + 20 * 4)
    }
    return
  }
  if (goalActive(world, c)) {
    c.activity = activityFor(c.intent ?? 'none')
    steer(c, c.goalX! - c.x, c.goalY! - c.y)
    return
  }
  if (c.energy < FOOD_THRESHOLD.rabbit) {
    const food = world.nearestFood(c.x, c.y, 11)
    if (food) { setAnimalGoal(c, 'foraging', 'food', food.x + 0.5, food.y + 0.5, world.tick + 20 * 12); return }
  }
  if (rabbitHabitatPoor(world, c)) {
    const habitat = world.bestHabitat(c.x, c.y, 'rabbit')
    if (habitat && habitat.score > world.habitatScore(Math.floor(c.x), Math.floor(c.y), 'rabbit') + 12) {
      setAnimalGoal(c, 'migrating', 'habitat', habitat.x + 0.5, habitat.y + 0.5, world.tick + 20 * 42)
      return
    }
  }
  if (c.energy > 91 && world.random.next() < 0.18) {
    setAnimalGoal(c, 'resting', 'rest', undefined, undefined, world.tick + 20 * (2 + world.random.next() * 3))
    return
  }
  clearAnimalGoal(c)
  const angle = world.random.next() * Math.PI * 2
  steer(c, Math.cos(angle), Math.sin(angle))
}

function wolfCanHuntHuman(world: World, wolf: Creature, human: Creature): boolean {
  return wolf.energy < 24 && !human.villageId && world.nearestVillageDistance(human.x, human.y) > VILLAGE_SAFE_RADIUS
}
function wolfCanHuntRabbit(world: World, wolf: Creature, rabbit: Creature): boolean {
  return world.nearestVillageDistance(rabbit.x, rabbit.y) > VILLAGE_SAFE_RADIUS || wolf.energy < 18
}

function decideWolf(world: World, c: Creature): void {
  const hazard = nearestHazard(world, c)
  const villageDistance = world.nearestVillageDistance(c.x, c.y)
  if (hazard) {
    setAnimalGoal(c, 'fleeing', 'fire', c.x + (c.x - hazard.x) * 3, c.y + (c.y - hazard.y) * 3, world.tick + 20 * 4)
    return
  }
  if (villageDistance < VILLAGE_SAFE_RADIUS) {
    const village = world.villages.reduce((nearest, candidate) => !nearest || distanceTo(c, candidate.x + 0.5, candidate.y + 0.5) < distanceTo(c, nearest.x + 0.5, nearest.y + 0.5) ? candidate : nearest, undefined as typeof world.villages[number] | undefined)
    if (village) { setAnimalGoal(c, 'migrating', 'danger', c.x + (c.x - village.x) * 3, c.y + (c.y - village.y) * 3, world.tick + 20 * 12); return }
  }
  const nearby = world.spatial.nearby(c.x, c.y, 10)
  const rabbits = nearby.filter(o => o.kind === 'rabbit' && o.life > 0 && wolfCanHuntRabbit(world, c, o))
  const prey = closest(c, rabbits.length ? rabbits : nearby.filter(o => o.kind === 'human' && o.life > 0 && wolfCanHuntHuman(world, c, o)))
  if (c.energy < FOOD_THRESHOLD.wolf && prey) {
    const distance = Math.sqrt(distance2(c, prey))
    setAnimalGoal(c, distance > 2.2 ? 'stalking' : 'hunting', 'prey', prey.x, prey.y, world.tick + 20 * 6)
    return
  }
  if (goalActive(world, c) && (c.intent === 'stalking' || c.intent === 'hunting')) {
    c.activity = activityFor(c.intent)
    steer(c, c.goalX! - c.x, c.goalY! - c.y)
    return
  }
  const habitat = world.bestHabitat(c.x, c.y, 'wolf')
  const here = world.habitatScore(Math.floor(c.x), Math.floor(c.y), 'wolf')
  if (habitat && habitat.score > here + 16) {
    setAnimalGoal(c, 'migrating', 'prey', habitat.x + 0.5, habitat.y + 0.5, world.tick + 20 * 38)
    return
  }
  if (c.energy > 90 && world.random.next() < 0.16) {
    setAnimalGoal(c, 'resting', 'rest', undefined, undefined, world.tick + 20 * (2 + world.random.next() * 3))
    return
  }
  clearAnimalGoal(c)
  const angle = world.random.next() * Math.PI * 2
  steer(c, Math.cos(angle), Math.sin(angle))
}

function decideHuman(world: World, c: Creature): void {
  const angle = world.random.next() * Math.PI * 2
  steer(c, Math.cos(angle), Math.sin(angle))
  c.activity = 'exploring'
  const nearby = world.spatial.nearby(c.x, c.y, 7)
  if (c.energy < FOOD_THRESHOLD.human) {
    const prey = closest(c, nearby.filter(o => o.kind === 'rabbit'))
    c.activity = 'hunting'
    if (prey) steer(c, prey.x - c.x, prey.y - c.y)
    else {
      const food = world.nearestFood(c.x, c.y, 7)
      c.activity = 'seeking-food'
      if (food) steer(c, food.x + 0.5 - c.x, food.y + 0.5 - c.y)
    }
  } else {
    const wolf = closest(c, nearby.filter(o => o.kind === 'wolf' && distance2(c, o) < 2.6))
    if (wolf) { c.activity = 'defending'; steer(c, wolf.x - c.x, wolf.y - c.y) }
    else if (c.energy > 94 && world.random.next() < 0.12) { c.activity = 'resting'; c.vx = c.vy = 0; c.decisionIn = 0.45 + world.random.next() * 0.55 }
  }
}

function damage(target: Creature, amount: number): boolean {
  target.life = Math.max(0, target.life - amount)
  target.hurt = Math.max(target.hurt, 0.42)
  return target.life <= 0
}

function rabbitCanBreed(world: World, c: Creature): boolean {
  const x = Math.floor(c.x), y = Math.floor(c.y)
  return world.vegetationAt(x, y) >= 42 && world.moistureAt(x, y) >= 38 && world.fertilityAt(x, y) >= 36
    && !world.spatial.nearby(c.x, c.y, 8).some(o => o.kind === 'wolf' && o.life > 0)
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
      if (c.kind === 'rabbit') decideRabbit(world, c)
      else if (c.kind === 'wolf') decideWolf(world, c)
      else decideHuman(world, c)
    }

    const village = c.kind === 'human' && c.villageId ? world.villages.find(v => v.id === c.villageId) : undefined
    if (village) {
      c.activity = 'working'
      const construction = world.buildings.find(b => b.villageId === village.id && b.progress < 1)
      const target = (c.task === 'gathering' ? world.nearestFood(c.x, c.y, 18)
        : c.task === 'lumber' ? world.nearestBiome(c.x, c.y, 'forest', 22)
          : c.task === 'mining' ? world.nearestBiome(c.x, c.y, 'mountain', 26)
            : c.task === 'building' && construction ? construction : village) ?? village
      const dx = target.x + 0.5 - c.x, dy = target.y + 0.5 - c.y
      if (dx * dx + dy * dy < 0.12) c.vx = c.vy = 0
      else steer(c, dx, dy)
    }

    if (c.kind !== 'wolf' && !['fleeing', 'hunting', 'defending', 'working'].includes(c.activity) && c.energy < 96) {
      const eaten = world.graze(tx, ty, (c.kind === 'rabbit' ? 5 : 3) * dt)
      c.energy = Math.min(100, c.energy + eaten * 1.25)
      if (eaten > 0) { c.activity = 'eating'; c.vx = c.vy = 0; c.decisionIn = Math.min(c.decisionIn, 0.3) }
    }
    const targets = world.spatial.nearby(c.x, c.y, 0.9).filter(o => o.life > 0 && (
      (c.kind === 'wolf' && c.energy < FOOD_THRESHOLD.wolf && (c.intent === 'stalking' || c.intent === 'hunting') && ((o.kind === 'rabbit' && wolfCanHuntRabbit(world, c, o)) || (o.kind === 'human' && wolfCanHuntHuman(world, c, o)))) ||
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
      if (fatal) { world.recordDeath(target, 'ataque'); c.energy = Math.min(100, c.energy + (c.kind === 'wolf' ? 32 : 24)); c.activity = 'eating'; c.decisionIn = Math.min(c.decisionIn, 0.35) }
    }

    if (!engaged && c.activity !== 'eating' && c.activity !== 'resting') {
      const speed = SPEED[c.kind] * dt * (c.activity === 'fleeing' || c.activity === 'sheltering' ? 1.35 : c.activity === 'stalking' ? 0.72 : 1)
      const nx = c.x + c.vx * speed, ny = c.y + c.vy * speed
      if (world.inBounds(Math.floor(nx), Math.floor(ny)) && WALKABLE.has(world.get(Math.floor(nx), Math.floor(ny)))) { c.x = nx; c.y = ny }
      else c.decisionIn = 0
    }

    if (c.kind === 'rabbit' && world.population.rabbit + births.length < RABBIT_LIMIT && c.age > 14 && c.energy > 88 && c.breedCooldown === 0 && rabbitCanBreed(world, c) && world.creatures.length + births.length < MAX_AGENTS) {
      const nearbyRabbits = world.spatial.nearby(c.x, c.y, 7).filter(o => o.kind === 'rabbit')
      const mate = nearbyRabbits.find(o => o.id !== c.id && o.energy > 84 && o.age > 14 && o.breedCooldown === 0 && rabbitCanBreed(world, o))
      if (mate && nearbyRabbits.length < 10 && world.random.next() < 0.16) {
        births.push({ x: tx, y: ty }); c.energy -= 16; mate.energy -= 10
        c.breedCooldown = mate.breedCooldown = 105 + world.random.next() * 45
      }
    }
  }
  world.creatures = world.creatures.filter(c => c.life > 0)
  for (const birth of births) world.spawn('rabbit', birth.x, birth.y)
  if (world.tick % 20 === 0) {
    const next: typeof world.fires = []
    for (const fire of world.fires) {
      const biome = world.get(fire.x, fire.y)
      if (!FLAMMABLE.has(biome)) continue
      const fuel = world.burnFuel(fire.x, fire.y, biome === 'forest' ? 7 : 16)
      fire.heat += 0.1
      if (fuel <= 4) { world.set(fire.x, fire.y, 'ash'); continue }
      const spreadChance = biome === 'forest' ? 0.12 : 0.035
      if (world.fires.length + next.length < MAX_FIRES && fuel > 25 && world.random.next() < spreadChance) {
        const a = Math.floor(world.random.next() * 8) * Math.PI / 4
        const x = fire.x + Math.round(Math.cos(a)), y = fire.y + Math.round(Math.sin(a)), key = world.index(x, y)
        if (world.inBounds(x, y) && FLAMMABLE.has(world.get(x, y)) && world.vegetationAt(x, y) > 30 && !burning.has(key)) { burning.add(key); next.push({ x, y, heat: 0.2 }) }
      }
      next.push(fire)
    }
    world.fires = next
  }
  if (world.tick % 20 === 0) { world.updateClimate(); world.regrowNature(); world.advanceVillages() }
  if (world.tick % 90 === 0) for (let i = 0; i < world.tiles.length; i++) if (world.tiles[i] === 'lava' && world.random.next() < 0.15) world.set(i % world.width, Math.floor(i / world.width), 'ash')
  for (const m of world.meteors) m.age += dt
  world.meteors = world.meteors.filter(m => m.age < 0.9)
  for (const rain of world.rainEffects) rain.age += dt
  world.rainEffects = world.rainEffects.filter(r => r.age < 2)
  world.recount()
  world.spatial.rebuild(world.creatures)
}
