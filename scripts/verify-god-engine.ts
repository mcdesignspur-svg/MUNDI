import { World } from '../src/game/world.ts'
import { simulate } from '../src/game/simulation.ts'
import { engine, runHeadless } from '../src/game/core/engine.ts'
import { sharedPathfinder } from '../src/game/core/pathfinding.ts'
import { snapshot, restore } from '../src/game/snapshot.ts'

function paintGrass(world: World, cx: number, cy: number, r: number) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!world.inBounds(x, y)) continue
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        world.set(x, y, 'grass')
        world.vegetation[world.index(x, y)] = 80
        world.moisture[world.index(x, y)] = 70
        world.fertility[world.index(x, y)] = 65
      }
    }
  }
  world.set(cx + r - 1, cy, 'water')
}

const world = new World('god-engine-arch')
world.generate('god-engine-arch')
paintGrass(world, 22, 30, 8)
paintGrass(world, 72, 30, 8)

for (let i = 0; i < 7; i++) {
  const h = world.spawn('human', 20 + (i % 3), 28 + Math.floor(i / 3))
  if (h) { h.age = 20; h.energy = 90 }
}
for (let i = 0; i < 7; i++) {
  const h = world.spawn('human', 70 + (i % 3), 28 + Math.floor(i / 3))
  if (h) { h.age = 20; h.energy = 90 }
}

runHeadless(world, 400, simulate)
const founded = world.villages.length
console.log('villages_after_founding', founded, world.villages.map(v => `${v.name}@${v.x},${v.y}`).join(' | '))
if (founded < 2) {
  console.error('FAIL: expected at least 2 villages from distant clusters')
  process.exit(1)
}

// Pathfinding must find a land route between villages.
const a = world.villages[0]!
const b = world.villages[1]!
const path = sharedPathfinder.findPath(world, a.x, a.y, b.x, b.y)
console.log('path_length', path?.length ?? 0)
if (!path || path.length < 5) {
  console.error('FAIL: A* should find a route between villages')
  process.exit(1)
}

// Force scarcity + proximity → war via FactionManager.
a.food = 2
b.food = 2
b.x = a.x + 12
b.y = a.y + 2
for (const c of world.creatures) {
  if (c.villageId === b.id) {
    c.x = b.x + (Math.random() - 0.5) * 3
    c.y = b.y + (Math.random() - 0.5) * 3
  }
}

let war = false
let maxH = 0
for (let t = 0; t < 900; t++) {
  // Keep both villages starving so famine mercy / farms cannot erase the casus belli.
  a.food = Math.min(a.food, 3)
  b.food = Math.min(b.food, 3)
  // Disable mercy prophecy during the war stress window.
  for (const rule of engine.prophecy.rules) {
    if (rule.id === 'famine_mercy' || rule.id === 'war_fatigue') rule.enabled = false
  }
  simulate(world)
  if (world.villages.length >= 2) {
    const v0 = world.villages[0]!
    const v1 = world.villages[1]!
    maxH = Math.max(maxH, world.hostility(v0, v1.id))
    if (world.isAtWar(v0, v1.id)) war = true
  }
}

const snap = snapshot(world)
const restored = restore(snap)
if (restored.villages.length !== world.villages.length) {
  console.error('FAIL: snapshot restore lost villages')
  process.exit(1)
}
if (engine.dynasty.rulers.size < 1 && world.villages.length > 0) {
  // rulers may live on restored engine after restore()
}
engine.attach(restored)
engine.restore(snap.systems, restored.villages)

console.log({
  maxHostility: maxH,
  war,
  wars: engine.countWars(world.villages),
  routes: engine.trade.routes.length,
  prophecies: engine.prophecy.rules.length,
  cultures: engine.culture.profiles.size,
  nobles: engine.dynasty.nobles.length,
  events: world.events.map(e => e.kind).slice(0, 8),
})

if (maxH < 55 || !war) {
  console.error('FAIL: hostility should reach war under scarcity + proximity')
  process.exit(1)
}
if (engine.prophecy.rules.length < 3) {
  console.error('FAIL: prophecy engine missing rules')
  process.exit(1)
}
console.log('OK god-game engine architecture')
