import { COMFORT, FLAMMABLE, MAX_AGENTS, MAX_AGE, WALKABLE, type Activity, type AnimalIntent, type AnimalReason, type Creature, type DeathCause, type Village } from './types'
import { berryYield, fishYield, hasKnowledge, huntDamage, huntFoodYield, lumberYield, stoneYield, workSpeed } from './progression'
import { MAX_FIRES, type World } from './world'

export const STEP = 1 / 20
const SPEED = { human: 1.85, rabbit: 3.4, wolf: 2.95 }
const METABOLISM = { human: 0.58, rabbit: 0.82, wolf: 0.88 }
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
function beginMigration(world: World, c: Creature, reason: AnimalReason, x: number, y: number, until: number): void {
  const alreadyHeadingThere = c.intent === 'migrating' && c.intentReason === reason && c.goalX !== undefined && c.goalY !== undefined && distanceTo(c, c.goalX, c.goalY) < 3
  setAnimalGoal(c, 'migrating', reason, x, y, until)
  if (!alreadyHeadingThere) world.recordEvent('migration', c.x, c.y, c.kind)
}
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
  if (world.surfaceWaterAt(tx, ty) > 60) return { x: tx + 0.5, y: ty + 0.5 }
  return best
}

function damage(target: Creature, amount: number): boolean {
  target.life = Math.max(0, target.life - amount)
  target.hurt = Math.max(target.hurt, 0.42)
  return target.life <= 0
}

function thermalStress(world: World, c: Creature): DeathCause | null {
  const temp = world.temperatureAt(Math.floor(c.x), Math.floor(c.y))
  const band = COMFORT[c.kind]
  const biome = world.get(Math.floor(c.x), Math.floor(c.y))
  const village = c.villageId ? world.villages.find(v => v.id === c.villageId) : undefined
  const firecraft = village ? hasKnowledge(village, 'firecraft') : false
  const shelter = biome === 'forest' || biome === 'snow' || !!c.villageId || firecraft
  // Only lethal far outside the comfort band; mild chill just raises metabolism elsewhere.
  if (temp < band.min - 8 - (shelter ? 4 : 0) - (firecraft ? 3 : 0)) {
    damage(c, Math.max(0.25, (band.min - 8 - temp) * 0.12) * STEP)
    return 'frio'
  }
  if (temp > band.max + 8 + (shelter ? 3 : 0)) {
    damage(c, Math.max(0.25, (temp - band.max - 8) * 0.1) * STEP)
    return 'calor'
  }
  return null
}

function villagerTarget(world: World, c: Creature, village: Village): { x: number; y: number } {
  const construction = world.buildings.find(b => b.villageId === village.id && b.progress < 1)
  if (c.task === 'building' && construction) return construction
  if (c.task === 'foraging') return world.nearestBerry(c.x, c.y, 20) ?? world.nearestFood(c.x, c.y, 18) ?? village
  if (c.task === 'fishing') return world.nearestShore(c.x, c.y, 24) ?? village
  if (c.task === 'lumber') return world.nearestBiome(c.x, c.y, 'forest', 26) ?? village
  if (c.task === 'mining') return world.nearestBiome(c.x, c.y, 'mountain', 28) ?? village
  if (c.task === 'hunting') {
    // Keep hunters local so rabbit warrens farther from the village can recover.
    const prey = closest(c, world.spatial.nearby(c.x, c.y, 10).filter(o => o.kind === 'rabbit' && o.life > 0))
    if (prey) return { x: prey.x - 0.5, y: prey.y - 0.5 }
    return world.nearestBerry(c.x, c.y, 16) ?? village
  }
  return village
}

function harvestAtSite(world: World, c: Creature, village: Village, dt: number): boolean {
  const tx = Math.floor(c.x), ty = Math.floor(c.y)
  const hasSawmill = world.buildings.some(b => b.villageId === village.id && b.type === 'sawmill' && b.progress >= 1)
  c.workTimer = (c.workTimer ?? 0) + dt
  if (c.task === 'foraging') {
    const got = world.pickBerries(tx, ty, 9 * dt)
    if (got > 0) {
      village.food += got * berryYield(village)
      village.progress.berries += got
      c.energy = Math.min(100, c.energy + got * 2)
      c.activity = 'working'
      return true
    }
  }
  if (c.task === 'lumber') {
    const got = world.chopTree(tx, ty, 10 * dt * workSpeed(village, 'lumber'))
    if (got > 0) {
      village.wood += got * lumberYield(village, hasSawmill)
      village.progress.trees += got
      c.activity = 'working'
      return true
    }
  }
  if (c.task === 'mining') {
    const got = world.mineStone(tx, ty, 8 * dt * workSpeed(village, 'mining'))
    if (got > 0) {
      village.stone += got * stoneYield(village)
      village.progress.stone += got
      c.activity = 'working'
      return true
    }
  }
  if (c.task === 'fishing') {
    const waterNear = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => {
      const x = tx + dx, y = ty + dy
      return world.inBounds(x, y) && (world.get(x, y) === 'water' || world.get(x, y) === 'deepWater')
    })
    if (waterNear && c.workTimer > 0.2) {
      const catchAmount = fishYield(village) * dt * 3.2
      village.food += catchAmount
      village.progress.fish += catchAmount
      c.energy = Math.min(100, c.energy + catchAmount * 1.5)
      c.activity = 'working'
      c.vx = c.vy = 0
      return true
    }
  }
  if (c.task === 'building') {
    c.activity = 'working'
    c.vx = c.vy = 0
    return true
  }
  return false
}

function rabbitHabitatPoor(world: World, c: Creature): boolean {
  const x = Math.floor(c.x), y = Math.floor(c.y)
  return world.vegetationAt(x, y) < 18 || world.moistureAt(x, y) < 28 || !world.nearestFood(c.x, c.y, 8)
}

function humanThreatensRabbit(human: Creature): boolean {
  // Village hunters and hungry people both count as predators; idle villagers do not.
  return human.task === 'hunting' || human.energy < 78 || (!human.villageId && human.energy < 86)
}

function decideRabbit(world: World, c: Creature): void {
  const night = world.dayPhase() === 'night' || world.dayPhase() === 'dusk'
  const nearby = world.spatial.nearby(c.x, c.y, night ? 12 : 10)
  const predator = closest(c, nearby.filter(o => o.life > 0 && (o.kind === 'wolf' || (o.kind === 'human' && humanThreatensRabbit(o)))))
  const hazard = nearestHazard(world, c)
  if (hazard) {
    setAnimalGoal(c, 'fleeing', 'fire', c.x + (c.x - hazard.x) * 3, c.y + (c.y - hazard.y) * 3, world.tick + 20 * 4)
    return
  }
  if (predator) {
    const cover = world.nearestBiome(c.x, c.y, 'forest', 12)
    if (cover && Math.hypot(cover.x + 0.5 - predator.x, cover.y + 0.5 - predator.y) > Math.hypot(c.x - predator.x, c.y - predator.y) + 1) {
      setAnimalGoal(c, 'sheltering', 'danger', cover.x + 0.5, cover.y + 0.5, world.tick + 20 * 8)
    } else {
      setAnimalGoal(c, 'fleeing', 'danger', c.x + (c.x - predator.x) * 4, c.y + (c.y - predator.y) * 4, world.tick + 20 * 4)
    }
    return
  }
  if (night && world.random.next() < 0.35) {
    const cover = world.nearestBiome(c.x, c.y, 'forest', 12) ?? world.nearestBiome(c.x, c.y, 'grass', 8)
    if (cover) { setAnimalGoal(c, 'sheltering', 'rest', cover.x + 0.5, cover.y + 0.5, world.tick + 20 * 10); return }
    setAnimalGoal(c, 'resting', 'rest', undefined, undefined, world.tick + 20 * 4)
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
      beginMigration(world, c, 'habitat', habitat.x + 0.5, habitat.y + 0.5, world.tick + 20 * 42)
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
  const night = world.dayPhase() === 'night' || world.dayPhase() === 'dusk'
  const hazard = nearestHazard(world, c)
  const villageDistance = world.nearestVillageDistance(c.x, c.y)
  if (hazard) {
    setAnimalGoal(c, 'fleeing', 'fire', c.x + (c.x - hazard.x) * 3, c.y + (c.y - hazard.y) * 3, world.tick + 20 * 4)
    return
  }
  if (villageDistance < VILLAGE_SAFE_RADIUS) {
    const village = world.villages.reduce((nearest, candidate) => !nearest || distanceTo(c, candidate.x + 0.5, candidate.y + 0.5) < distanceTo(c, nearest.x + 0.5, nearest.y + 0.5) ? candidate : nearest, undefined as typeof world.villages[number] | undefined)
    if (village) { beginMigration(world, c, 'danger', c.x + (c.x - village.x) * 3, c.y + (c.y - village.y) * 3, world.tick + 20 * 12); return }
  }
  const huntRadius = night ? 12 : 9
  const nearby = world.spatial.nearby(c.x, c.y, huntRadius)
  const rabbits = nearby.filter(o => o.kind === 'rabbit' && o.life > 0 && wolfCanHuntRabbit(world, c, o))
  const prey = closest(c, rabbits.length ? rabbits : nearby.filter(o => o.kind === 'human' && o.life > 0 && wolfCanHuntHuman(world, c, o)))
  // Night still favors wolves, but they no longer hunt on a nearly full stomach.
  const hungry = c.energy < FOOD_THRESHOLD.wolf || (night && c.energy < 84)
  if (hungry && prey) {
    const distance = Math.sqrt(distance2(c, prey))
    setAnimalGoal(c, distance > 2.2 ? 'stalking' : 'hunting', 'prey', prey.x, prey.y, world.tick + 20 * 6)
    return
  }
  if (goalActive(world, c) && (c.intent === 'stalking' || c.intent === 'hunting')) {
    c.activity = activityFor(c.intent)
    steer(c, c.goalX! - c.x, c.goalY! - c.y)
    return
  }
  if (!night && c.energy > 70 && world.random.next() < 0.22) {
    setAnimalGoal(c, 'resting', 'rest', undefined, undefined, world.tick + 20 * (3 + world.random.next() * 4))
    return
  }
  const habitat = world.bestHabitat(c.x, c.y, 'wolf')
  const here = world.habitatScore(Math.floor(c.x), Math.floor(c.y), 'wolf')
  if (habitat && habitat.score > here + 16) {
    beginMigration(world, c, 'prey', habitat.x + 0.5, habitat.y + 0.5, world.tick + 20 * 38)
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
  const phase = world.dayPhase()
  if ((phase === 'night' || phase === 'dusk') && c.energy > 55 && world.random.next() < 0.4) {
    const village = world.villages[0]
    if (village) { c.activity = 'resting'; steer(c, village.x + 0.5 - c.x, village.y + 0.5 - c.y); return }
    c.activity = 'resting'; c.vx = c.vy = 0; c.decisionIn = 0.8; return
  }
  if (c.energy < FOOD_THRESHOLD.human) {
    const prey = closest(c, nearby.filter(o => o.kind === 'rabbit'))
    c.activity = 'hunting'
    if (prey) steer(c, prey.x - c.x, prey.y - c.y)
    else {
      const berries = world.nearestBerry(c.x, c.y, 9) ?? world.nearestFood(c.x, c.y, 7)
      c.activity = 'seeking-food'
      if (berries) steer(c, berries.x + 0.5 - c.x, berries.y + 0.5 - c.y)
    }
  } else {
    const wolf = closest(c, nearby.filter(o => o.kind === 'wolf' && distance2(c, o) < 2.6))
    if (wolf) { c.activity = 'defending'; steer(c, wolf.x - c.x, wolf.y - c.y) }
    else if (c.energy > 94 && world.random.next() < 0.12) { c.activity = 'resting'; c.vx = c.vy = 0; c.decisionIn = 0.45 + world.random.next() * 0.55 }
  }
}

function rabbitCanBreed(world: World, c: Creature): boolean {
  const x = Math.floor(c.x), y = Math.floor(c.y)
  // Under dual predation, allow breeding in slightly thinner forage so colonies rebound.
  const scarce = world.population.rabbit < 20
  const vegNeed = scarce ? 30 : 42
  const moistNeed = scarce ? 28 : 38
  const fertNeed = scarce ? 26 : 36
  return world.vegetationAt(x, y) >= vegNeed && world.moistureAt(x, y) >= moistNeed && world.fertilityAt(x, y) >= fertNeed
    && world.temperatureAt(x, y) > 2 && world.temperatureAt(x, y) < 32
    && !world.spatial.nearby(c.x, c.y, scarce ? 4 : 8).some(o => o.kind === 'wolf' && o.life > 0)
}

function rabbitEvadesStrike(world: World, rabbit: Creature, predator: Creature): boolean {
  const biome = world.get(Math.floor(rabbit.x), Math.floor(rabbit.y))
  const fleeing = rabbit.activity === 'fleeing' || rabbit.activity === 'sheltering'
  const night = world.dayPhase() === 'night' || world.dayPhase() === 'dusk'
  // Humans are noisy hunters; wolves land more bites, especially at night.
  let miss = predator.kind === 'human' ? (fleeing ? 0.38 : 0.1) : (fleeing ? 0.2 : 0.05)
  if (biome === 'forest') miss += predator.kind === 'human' ? 0.22 : 0.12
  if (predator.kind === 'wolf' && night) miss *= 0.6
  if (world.population.rabbit < 14) miss += 0.18
  return world.random.next() < miss
}

function windBiasedNeighbor(world: World): { x: number; y: number } {
  const windX = Math.cos(world.windAngle), windY = Math.sin(world.windAngle)
  if (world.random.next() < 0.55 + world.windStrength * 0.35) {
    return { x: Math.round(windX) || (windX >= 0 ? 1 : -1), y: Math.round(windY) }
  }
  const a = Math.floor(world.random.next() * 8) * Math.PI / 4
  return { x: Math.round(Math.cos(a)), y: Math.round(Math.sin(a)) }
}

export function simulate(world: World, dt = STEP): void {
  world.tick++
  world.revision++
  world.spatial.rebuild(world.creatures)
  const burning = new Set(world.fires.map(f => world.index(f.x, f.y)))
  const births: { x: number; y: number }[] = []
  const humanBirths: { x: number; y: number; villageId: number }[] = []
  const wolfBirths: { x: number; y: number }[] = []
  for (const c of world.creatures) {
    if (c.life <= 0) continue
    let deathCause: DeathCause | null = null
    c.age += dt
    c.decisionIn -= dt
    c.breedCooldown = Math.max(0, c.breedCooldown - dt)
    c.attackCooldown = Math.max(0, c.attackCooldown - dt)
    c.hurt = Math.max(0, c.hurt - dt)
    const cold = world.temperatureAt(Math.floor(c.x), Math.floor(c.y)) < COMFORT[c.kind].min
    c.energy -= METABOLISM[c.kind] * dt * (c.activity === 'resting' ? 0.5 : 1) * (cold ? 1.25 : 1)
    if (c.energy <= 0) { damage(c, 4 * dt); deathCause = 'hambruna' }
    const thermal = thermalStress(world, c)
    if (thermal && c.life <= 0) deathCause = thermal
    else if (thermal) deathCause = deathCause ?? thermal
    const tx = Math.floor(c.x), ty = Math.floor(c.y)
    if (burning.has(world.index(tx, ty))) { damage(c, 14 * dt); deathCause = 'fuego' }
    if (world.get(tx, ty) === 'lava') { damage(c, 35 * dt); deathCause = 'lava' }
    if (c.age >= MAX_AGE[c.kind]) { c.life = 0; deathCause = 'vejez' }
    if (c.life <= 0) { world.recordDeath(c, deathCause ?? 'ataque'); continue }

    // Painting water, a meteor, or map generation can leave a creature on a
    // non-walkable tile. Give it a direct shoreline target so it never waits
    // indefinitely for a random direction that happens to work.
    const stranded = !WALKABLE.has(world.get(tx, ty)) || world.surfaceWaterAt(tx, ty) > 70
    if (stranded) {
      const shore = world.nearestWalkable(c.x, c.y)
      if (shore) {
        if ((c.waterEscapeUntil ?? 0) <= world.tick) {
          world.recordEvent('rescue', c.x, c.y, c.kind)
          c.waterEscapeUntil = world.tick + 20 * 20
        }
        if (c.kind === 'human') { c.activity = 'fleeing'; steer(c, shore.x + 0.5 - c.x, shore.y + 0.5 - c.y) }
        else setAnimalGoal(c, 'fleeing', 'water', shore.x + 0.5, shore.y + 0.5, world.tick + 20 * 20)
        c.decisionIn = Math.max(c.decisionIn, 0.5)
      }
    } else if (c.decisionIn <= 0) {
      c.decisionIn = 0.45 + world.random.next() * 0.75
      if (c.kind === 'rabbit') decideRabbit(world, c)
      else if (c.kind === 'wolf') decideWolf(world, c)
      else decideHuman(world, c)
    }

    const village = c.kind === 'human' && c.villageId ? world.villages.find(v => v.id === c.villageId) : undefined
    let harvesting = false
    if (village) {
      c.activity = 'working'
      const target = villagerTarget(world, c, village)
      c.goalX = target.x + 0.5
      c.goalY = target.y + 0.5
      const dx = c.goalX - c.x, dy = c.goalY - c.y
      const arrived = dx * dx + dy * dy < (c.task === 'hunting' ? 0.85 : 0.35)
      if (arrived) {
        c.vx = c.vy = 0
        harvesting = harvestAtSite(world, c, village, dt)
        if (!harvesting && c.task === 'hunting') {
          // Stay ready to strike; combat block below handles the kill.
          c.activity = 'hunting'
        } else if (!harvesting) {
          c.workTimer = 0
          c.decisionIn = 0
        }
      } else {
        c.workTimer = 0
        steer(c, dx, dy)
      }
    }

    if (c.kind !== 'wolf' && !['fleeing', 'hunting', 'defending', 'working'].includes(c.activity) && c.energy < 96) {
      const eaten = world.graze(tx, ty, (c.kind === 'rabbit' ? 5 : 3) * dt)
      c.energy = Math.min(100, c.energy + eaten * 1.25)
      if (eaten > 0) { c.activity = 'eating'; c.vx = c.vy = 0; c.decisionIn = Math.min(c.decisionIn, 0.3) }
    }
    const villageForHunt = village
    const targets = world.spatial.nearby(c.x, c.y, 0.9).filter(o => o.life > 0 && (
      (c.kind === 'wolf' && c.energy < FOOD_THRESHOLD.wolf && (c.intent === 'stalking' || c.intent === 'hunting') && ((o.kind === 'rabbit' && wolfCanHuntRabbit(world, c, o)) || (o.kind === 'human' && wolfCanHuntHuman(world, c, o)))) ||
      (c.kind === 'human' && o.kind === 'wolf') ||
      (c.kind === 'human' && o.kind === 'rabbit' && world.population.rabbit >= 10 && (c.energy < 78 || c.task === 'hunting'))
    ))
    const target = closest(c, targets)
    let engaged = false
    if (target && c.attackCooldown === 0) {
      engaged = true
      const defending = c.kind === 'human' && target.kind === 'wolf'
      c.activity = defending ? 'defending' : 'hunting'
      c.vx = c.vy = 0
      // Escaping rabbits in cover often slip the strike; predators burn the cooldown either way.
      if (target.kind === 'rabbit' && rabbitEvadesStrike(world, target, c)) {
        c.attackCooldown = c.kind === 'wolf' ? 0.55 : 0.7
        if (target.activity !== 'fleeing' && target.activity !== 'sheltering') {
          setAnimalGoal(target, 'fleeing', 'danger', target.x + (target.x - c.x) * 4, target.y + (target.y - c.y) * 4, world.tick + 20 * 5)
          target.decisionIn = 0.35
        }
      } else {
        const humanStrike = c.kind === 'human' ? huntDamage(villageForHunt) : (target.kind === 'wolf' ? 8 : 6)
        const wolfStrike = target.kind === 'human' ? 7 : 9
        const fatal = damage(target, c.kind === 'wolf' ? wolfStrike : humanStrike)
        c.attackCooldown = c.kind === 'wolf' ? 0.75 : 0.85
        if (fatal) {
          world.recordEvent('hunt', target.x, target.y, target.kind)
          world.recordDeath(target, 'ataque')
          c.energy = Math.min(100, c.energy + (c.kind === 'wolf' ? 38 : 24))
          c.activity = 'eating'
          c.decisionIn = Math.min(c.decisionIn, 0.35)
          if (c.kind === 'human' && villageForHunt && target.kind === 'rabbit') {
            villageForHunt.food += huntFoodYield(villageForHunt)
            villageForHunt.progress.hunts++
          }
        }
      }
    }

    if (!engaged && !harvesting && c.activity !== 'eating' && c.activity !== 'resting') {
      const nightSlow = world.dayPhase() === 'night' && c.kind === 'rabbit' ? 0.75 : world.dayPhase() === 'night' && c.kind === 'wolf' ? 1.16 : 1
      const fleeBoost = (c.activity === 'fleeing' || c.activity === 'sheltering') ? (c.kind === 'rabbit' ? 1.42 : 1.35) : c.activity === 'stalking' ? 0.72 : 1
      const speed = SPEED[c.kind] * dt * nightSlow * fleeBoost
      const nx = c.x + c.vx * speed, ny = c.y + c.vy * speed
      // A stranded creature may cross a few water cells only while following
      // its emergency shore route; ordinary navigation still never enters water.
      const nxTile = Math.floor(nx), nyTile = Math.floor(ny)
      if (world.inBounds(nxTile, nyTile) && ((WALKABLE.has(world.get(nxTile, nyTile)) && world.surfaceWaterAt(nxTile, nyTile) < 70) || stranded)) { c.x = nx; c.y = ny }
      else c.decisionIn = 0
    } else if (harvesting) {
      c.vx = c.vy = 0
    }

    if (c.kind === 'rabbit' && world.population.rabbit + births.length < RABBIT_LIMIT && c.age > 12 && c.energy > 80 && c.breedCooldown === 0 && rabbitCanBreed(world, c) && world.creatures.length + births.length < MAX_AGENTS) {
      const nearbyRabbits = world.spatial.nearby(c.x, c.y, 8).filter(o => o.kind === 'rabbit')
      const mate = nearbyRabbits.find(o => o.id !== c.id && o.energy > 76 && o.age > 12 && o.breedCooldown === 0 && rabbitCanBreed(world, o))
      const scarce = world.population.rabbit < 20
      const breedChance = scarce ? 0.32 : nearbyRabbits.length < 6 ? 0.18 : 0.14
      if (mate && nearbyRabbits.length < (scarce ? 14 : 10) && world.random.next() < breedChance) {
        births.push({ x: tx, y: ty }); c.energy -= 14; mate.energy -= 9
        c.breedCooldown = mate.breedCooldown = (scarce ? 55 : 95) + world.random.next() * (scarce ? 28 : 45)
      }
    }
    if (c.kind === 'human' && c.villageId && c.age > 40 && c.age < MAX_AGE.human * 0.72 && c.energy > 70 && c.breedCooldown === 0 && world.creatures.length + humanBirths.length < MAX_AGENTS) {
      const village = world.villages.find(v => v.id === c.villageId)
      const villagers = village ? world.creatures.filter(o => o.villageId === village.id && o.life > 0) : []
      const needsHeir = villagers.some(o => o.age > MAX_AGE.human * 0.62)
      if (village && village.food > 40 && (villagers.length < 18 || (needsHeir && villagers.length < 22))) {
        const mate = villagers.find(o => o.id !== c.id && o.age > 40 && o.age < MAX_AGE.human * 0.72 && o.breedCooldown === 0 && o.energy > 65)
        if (mate && world.random.next() < (needsHeir ? 0.08 : 0.045)) {
          humanBirths.push({ x: village.x, y: village.y, villageId: village.id })
          c.energy -= 12; mate.energy -= 8; village.food -= 8
          c.breedCooldown = mate.breedCooldown = needsHeir ? 90 + world.random.next() * 40 : 180 + world.random.next() * 60
        }
      }
    }
    if (c.kind === 'wolf' && world.population.wolf < 12 && c.age > 28 && c.energy > 74 && c.breedCooldown === 0 && world.creatures.length + wolfBirths.length < MAX_AGENTS) {
      const mate = world.spatial.nearby(c.x, c.y, 7).find(o => o.kind === 'wolf' && o.id !== c.id && o.energy > 68 && o.breedCooldown === 0 && o.age > 28)
      const preyNearby = world.spatial.nearby(c.x, c.y, 10).some(o => o.kind === 'rabbit' && o.life > 0)
      if (mate && preyNearby && world.random.next() < 0.07) {
        wolfBirths.push({ x: tx, y: ty })
        c.energy -= 16; mate.energy -= 10
        c.breedCooldown = mate.breedCooldown = 180 + world.random.next() * 70
      }
    }
  }
  world.creatures = world.creatures.filter(c => c.life > 0)
  for (const birth of births) {
    if (world.spawn('rabbit', birth.x, birth.y)) world.recordEvent('birth', birth.x + 0.5, birth.y + 0.5, 'rabbit')
  }
  for (const birth of humanBirths) {
    const child = world.spawn('human', birth.x, birth.y)
    if (child) {
      child.villageId = birth.villageId
      child.task = 'foraging'
      child.activity = 'working'
      child.age = 0
      child.breedCooldown = 55
      world.recordEvent('birth', child.x, child.y, 'human')
    }
  }
  for (const birth of wolfBirths) {
    if (world.spawn('wolf', birth.x, birth.y)) world.recordEvent('birth', birth.x + 0.5, birth.y + 0.5, 'wolf')
  }
  if (world.tick % 20 === 0) {
    const next: typeof world.fires = []
    const wet = world.weather === 'rain' || world.weather === 'storm'
    for (const fire of world.fires) {
      const biome = world.get(fire.x, fire.y)
      if (!FLAMMABLE.has(biome)) continue
      if (wet && world.random.next() < (world.weather === 'storm' ? 0.35 : 0.18)) continue
      if (world.surfaceWaterAt(fire.x, fire.y) > 35) continue
      const fuel = world.burnFuel(fire.x, fire.y, biome === 'forest' ? 7 : 16)
      fire.heat += 0.1
      if (fuel <= 4) { world.set(fire.x, fire.y, 'ash'); continue }
      const dryBoost = world.weather === 'drought' ? 1.6 : world.moistureAt(fire.x, fire.y) < 30 ? 1.25 : 1
      const spreadChance = (biome === 'forest' ? 0.12 : 0.035) * dryBoost * (0.7 + world.windStrength)
      if (world.fires.length + next.length < MAX_FIRES && fuel > 25 && world.random.next() < spreadChance) {
        const dir = windBiasedNeighbor(world)
        const x = fire.x + dir.x, y = fire.y + dir.y, key = world.index(x, y)
        if (world.inBounds(x, y) && FLAMMABLE.has(world.get(x, y)) && world.vegetationAt(x, y) > 30 && !burning.has(key)) { burning.add(key); next.push({ x, y, heat: 0.2 }) }
      }
      next.push(fire)
    }
    world.fires = next
    if (world.weather === 'storm' && world.random.next() < 0.08) {
      const x = 4 + Math.floor(world.random.next() * (world.width - 8))
      const y = 4 + Math.floor(world.random.next() * (world.height - 8))
      if (FLAMMABLE.has(world.get(x, y)) && world.vegetationAt(x, y) > 40) world.ignite(x, y, 0)
    }
  }
  if (world.tick % 20 === 0) { world.updateClimate(); world.regrowNature(); world.advanceVillages() }
  if (world.tick % 90 === 0) for (let i = 0; i < world.tiles.length; i++) if (world.tiles[i] === 'lava' && world.random.next() < 0.15) world.set(i % world.width, Math.floor(i / world.width), 'ash')
  for (const m of world.meteors) m.age += dt
  world.meteors = world.meteors.filter(m => m.age < 0.9)
  for (const rain of world.rainEffects) rain.age += dt
  world.rainEffects = world.rainEffects.filter(r => r.age < 2)
  world.recount()
  world.capturePopulationHistory()
  world.spatial.rebuild(world.creatures)
}
