/**
 * Headless balance probe across seeded worlds.
 * Usage: node scripts/balance-rabbits.mjs
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const tmp = mkdtempSync(join(tmpdir(), 'mundi-balance-'))
const entry = join(tmp, 'run.mts')
writeFileSync(entry, `
import { World } from '${root.replaceAll('\\\\', '/')}/src/game/world.ts'
import { simulate, STEP } from '${root.replaceAll('\\\\', '/')}/src/game/simulation.ts'

const seeds = ['balance-1', 'balance-7', 'balance-42', 'balance-99', 'balance-123']
const ticks = 20 * 60 * 10 // ~10 in-game minutes
const samples = []

for (const seed of seeds) {
  const world = new World(seed)
  world.populate()
  const start = { ...world.population }
  let minRabbit = start.rabbit
  let minWolf = start.wolf
  let zeroRabbitAt = null
  let zeroWolfAt = null
  for (let t = 0; t < ticks; t++) {
    simulate(world, STEP)
    minRabbit = Math.min(minRabbit, world.population.rabbit)
    minWolf = Math.min(minWolf, world.population.wolf)
    if (world.population.rabbit === 0 && zeroRabbitAt === null) zeroRabbitAt = t
    if (world.population.wolf === 0 && zeroWolfAt === null) zeroWolfAt = t
  }
  const rabbitDeaths = world.deaths.filter(d => d.kind === 'rabbit')
  const byCause = Object.create(null)
  for (const d of rabbitDeaths) byCause[d.cause] = (byCause[d.cause] ?? 0) + 1
  samples.push({
    seed,
    start,
    end: { ...world.population },
    minRabbit,
    minWolf,
    zeroRabbitAt,
    zeroWolfAt,
    rabbitDeaths: rabbitDeaths.length,
    byCause,
    villages: world.villages.length,
    hunts: world.villages.reduce((n, v) => n + v.progress.hunts, 0),
    food: world.villages[0]?.food ?? null,
  })
}

console.log(JSON.stringify(samples, null, 2))
const rabbitExtinct = samples.filter(s => s.end.rabbit === 0).length
const wolfExtinct = samples.filter(s => s.end.wolf === 0).length
const avgRabbit = samples.reduce((n, s) => n + s.end.rabbit, 0) / samples.length
const avgWolf = samples.reduce((n, s) => n + s.end.wolf, 0) / samples.length
const avgMinRabbit = samples.reduce((n, s) => n + s.minRabbit, 0) / samples.length
const avgHunts = samples.reduce((n, s) => n + s.hunts, 0) / samples.length
// Wolves collapsing late is a known soft spot; this probe focuses on rabbits surviving dual pressure.
const ok = rabbitExtinct === 0 && avgRabbit >= 12 && avgMinRabbit >= 5 && avgHunts >= 1 && avgHunts <= 8
console.log(JSON.stringify({ rabbitExtinct, wolfExtinct, avgRabbit, avgWolf, avgMinRabbit, avgHunts, ok, vsMain: { avgRabbit: 2.4, hunts: 15 } }, null, 2))
if (!ok) process.exitCode = 2
`)

const result = spawnSync('npx', ['--yes', 'tsx', entry], {
  cwd: root,
  encoding: 'utf8',
  timeout: 240_000,
})
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
rmSync(tmp, { recursive: true, force: true })
process.exit(result.status ?? 1)
