import { FLAMMABLE, WALKABLE, type Biome, type Creature } from './types'
import type { World } from './world'

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const

function tileAt(world: World, x: number, y: number): Biome | null {
  const tx = Math.floor(x)
  const ty = Math.floor(y)
  if (!world.inBounds(tx, ty)) return null
  return world.get(tx, ty)
}

function canWalk(biome: Biome | null): boolean {
  if (!biome || biome === 'lava') return false
  return WALKABLE.has(biome)
}

function randomDir(): { vx: number; vy: number } {
  const a = Math.random() * Math.PI * 2
  return { vx: Math.cos(a), vy: Math.sin(a) }
}

export function simulate(world: World, dt: number): void {
  world.tick++
  stepFires(world)
  if (world.tick % 12 === 0) world.regrowNature()
  stepCreatures(world, dt)
  for (const m of world.meteors) m.age += dt
  world.meteors = world.meteors.filter((m) => m.age < 0.9)
  if (world.tick % 90 === 0) {
    for (let i = 0; i < world.tiles.length; i++) {
      if (world.tiles[i] === 'lava' && Math.random() < 0.15) world.tiles[i] = 'ash'
    }
  }
}

function stepFires(world: World): void {
  if (world.tick % 4 !== 0) return
  const next: typeof world.fires = []
  const occupied = new Set(world.fires.map((f) => `${f.x},${f.y}`))

  for (const fire of world.fires) {
    const biome = world.get(fire.x, fire.y)
    if (!FLAMMABLE.has(biome)) continue
    fire.heat += 0.08
    if (fire.heat > 1.2 && (biome === 'forest' || biome === 'grass')) {
      world.set(fire.x, fire.y, 'ash')
    }
    if (Math.random() < 0.35) {
      const [dx, dy] = DIRS[(Math.random() * DIRS.length) | 0]!
      const nx = fire.x + dx
      const ny = fire.y + dy
      if (world.inBounds(nx, ny)) {
        const key = `${nx},${ny}`
        if (FLAMMABLE.has(world.get(nx, ny)) && !occupied.has(key)) {
          occupied.add(key)
          next.push({ x: nx, y: ny, heat: 0.2 })
        }
      }
    }
    if (fire.heat < 2.5 && Math.random() > 0.08) next.push(fire)
    else if (world.get(fire.x, fire.y) !== 'ash') world.set(fire.x, fire.y, 'ash')
  }
  world.fires = next

  for (const c of world.creatures) {
    const tx = Math.floor(c.x)
    const ty = Math.floor(c.y)
    if (world.fires.some((f) => f.x === tx && f.y === ty)) c.life -= 8
    if (tileAt(world, c.x, c.y) === 'lava') c.life -= 20
  }
  world.creatures = world.creatures.filter((c) => c.life > 0)
  world.recount()
}

function stepCreatures(world: World, dt: number): void {
  const speed: Record<Creature['kind'], number> = {
    human: 1.6,
    rabbit: 2.4,
    wolf: 2.0,
  }
  const metabolism: Record<Creature['kind'], number> = {
    human: 1.1,
    rabbit: 1.45,
    wolf: 1.9,
  }
  const births: { kind: Creature['kind']; x: number; y: number }[] = []

  for (const c of world.creatures) {
    c.age += dt
    c.breedCooldown = Math.max(0, c.breedCooldown - dt)
    c.energy -= metabolism[c.kind] * dt
    if (c.energy <= 0) c.life -= 4 * dt

    if (c.age % 1.2 < dt || (c.vx === 0 && c.vy === 0)) {
      const dir = randomDir()
      c.vx = dir.vx
      c.vy = dir.vy
      if (c.kind === 'wolf') {
        let best: Creature | null = null
        let bestD = 36
        for (const o of world.creatures) {
          if (o.kind !== 'rabbit') continue
          const d = (o.x - c.x) ** 2 + (o.y - c.y) ** 2
          if (d < bestD) {
            bestD = d
            best = o
          }
        }
        if (best) {
          const dx = best.x - c.x
          const dy = best.y - c.y
          const len = Math.hypot(dx, dy) || 1
          c.vx = dx / len
          c.vy = dy / len
        }
      } else if (c.kind === 'rabbit' || c.kind === 'human') {
        const food = world.nearestFood(c.x, c.y, c.kind === 'rabbit' ? 7 : 5)
        if (food && c.energy < 92) {
          const dx = food.x + 0.5 - c.x
          const dy = food.y + 0.5 - c.y
          const len = Math.hypot(dx, dy) || 1
          c.vx = dx / len
          c.vy = dy / len
        }
      }
    }
    const sp = speed[c.kind] * dt
    const nx = c.x + c.vx * sp
    const ny = c.y + c.vy * sp
    if (canWalk(tileAt(world, nx, ny))) {
      c.x = nx
      c.y = ny
    } else {
      const dir = randomDir()
      c.vx = dir.vx
      c.vy = dir.vy
    }
    c.x = Math.min(world.width - 0.1, Math.max(0.1, c.x))
    c.y = Math.min(world.height - 0.1, Math.max(0.1, c.y))

    const tx = Math.floor(c.x)
    const ty = Math.floor(c.y)
    if (c.kind === 'rabbit' || c.kind === 'human') {
      const eaten = world.graze(tx, ty, (c.kind === 'rabbit' ? 11 : 7) * dt)
      c.energy = Math.min(100, c.energy + eaten * 1.8)
    }

    if (c.kind === 'wolf') {
      const prey = world.creatures.find(
        (other) =>
          other.kind === 'rabbit' && other.life > 0 && (other.x - c.x) ** 2 + (other.y - c.y) ** 2 < 0.55,
      )
      if (prey) {
        prey.life = 0
        c.energy = Math.min(100, c.energy + 38)
      }
    }

    if (
      c.kind === 'rabbit' &&
      c.age > 8 &&
      c.energy > 78 &&
      c.breedCooldown === 0 &&
      world.creatures.length + births.length < 180
    ) {
      const mate = world.creatures.some(
        (other) => other !== c && other.kind === 'rabbit' && other.energy > 58 && (other.x - c.x) ** 2 + (other.y - c.y) ** 2 < 16,
      )
      if (mate) {
        births.push({ kind: 'rabbit', x: Math.floor(c.x + Math.random() * 3 - 1), y: Math.floor(c.y + Math.random() * 3 - 1) })
        c.energy -= 20
        c.breedCooldown = 14 + Math.random() * 8
      }
    }
  }
  world.creatures = world.creatures.filter((c) => c.life > 0 && c.energy > -18)
  for (const birth of births) world.spawn(birth.kind, birth.x, birth.y)
  world.recount()
}
