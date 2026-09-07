import { World } from '../src/game/world.ts'
import { simulate } from '../src/game/simulation.ts'

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

const world = new World('multi-village-test')
world.generate('multi-village-test')
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

for (let t = 0; t < 400; t++) simulate(world)
const founded = world.villages.length
console.log('villages_after_founding', founded, world.villages.map(v => `${v.name}@${v.x},${v.y}`).join(' | '))
if (founded < 2) {
  console.error('FAIL: expected at least 2 villages from distant clusters')
  process.exit(1)
}

const a = world.villages[0]!
const b = world.villages[1]!
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
for (let t = 0; t < 800; t++) {
  simulate(world)
  if (world.villages.length >= 2) {
    const v0 = world.villages[0]!
    const v1 = world.villages[1]!
    maxH = Math.max(maxH, world.hostility(v0, v1.id))
    if (world.isAtWar(v0, v1.id)) war = true
  }
}

const raids = world.events.filter(e => e.kind === 'raid').length
const wars = world.events.filter(e => e.kind === 'war').length
const raidTasks = world.creatures.filter(c => c.task === 'raiding').length
console.log({ maxHostility: maxH, war, warEvents: wars, raidEvents: raids, currentRaiders: raidTasks, villages: world.villages.length })
if (maxH < 55 || !war) {
  console.error('FAIL: hostility should be able to reach war under scarcity + proximity')
  process.exit(1)
}
console.log('OK multi-village + emergent war path')
