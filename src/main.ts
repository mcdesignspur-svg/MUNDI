import './style.css'
import { Camera } from './game/camera'
import { InputController, type InputState } from './game/input'
import { Renderer } from './game/renderer'
import { simulate } from './game/simulation'
import type { ToolId } from './game/types'
import { TILE, World, WORLD_H, WORLD_W } from './game/world'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="stage"><canvas id="world"></canvas></div>
  <header class="brand">
    <h1>MUNDI</h1>
    <p>Simula un mundo. Pinta biomas, siembra vida y desata el caos.</p>
  </header>
  <aside class="hud">
    <div class="stat-bar" id="stats">Cargando…</div>
  </aside>
  <p class="hint">Rueda = zoom · Espacio + arrastrar = pan · Clic = herramienta</p>
  <div class="toolbar">
    <div class="tool-row" id="biomes">
      <div class="label">Biomas</div>
    </div>
    <div class="tool-row" id="life">
      <div class="label">Vida</div>
    </div>
    <div class="tool-row" id="chaos">
      <div class="label">Desastres</div>
    </div>
    <div class="controls">
      <button type="button" id="btn-pan" data-tool="pan">Mano</button>
      <button type="button" id="btn-pause">Pausa</button>
      <button type="button" id="btn-new">Nuevo mundo</button>
      <label>Pincel <input id="brush" type="range" min="0" max="5" value="1" /></label>
      <label>Velocidad <input id="speed" type="range" min="0" max="3" step="1" value="1" /></label>
    </div>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#world')!
const statsEl = document.querySelector<HTMLDivElement>('#stats')!
const biomesEl = document.querySelector<HTMLDivElement>('#biomes')!
const lifeEl = document.querySelector<HTMLDivElement>('#life')!
const chaosEl = document.querySelector<HTMLDivElement>('#chaos')!

const biomeTools: { id: ToolId; label: string }[] = [
  { id: 'paint-deepWater', label: 'Océano' },
  { id: 'paint-water', label: 'Agua' },
  { id: 'paint-sand', label: 'Arena' },
  { id: 'paint-grass', label: 'Hierba' },
  { id: 'paint-forest', label: 'Bosque' },
  { id: 'paint-mountain', label: 'Montaña' },
  { id: 'paint-snow', label: 'Nieve' },
]

const lifeTools: { id: ToolId; label: string; cls?: string }[] = [
  { id: 'spawn-human', label: 'Humano', cls: 'nature' },
  { id: 'spawn-rabbit', label: 'Conejo', cls: 'nature' },
  { id: 'spawn-wolf', label: 'Lobo', cls: 'nature' },
]

const chaosTools: { id: ToolId; label: string; cls?: string }[] = [
  { id: 'disaster-fire', label: 'Fuego', cls: 'danger' },
  { id: 'disaster-meteor', label: 'Meteorito', cls: 'danger' },
  { id: 'disaster-rain', label: 'Lluvia', cls: 'nature' },
]

function mountTools(
  root: HTMLElement,
  tools: { id: ToolId; label: string; cls?: string }[],
): void {
  for (const t of tools) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `tool${t.cls ? ` ${t.cls}` : ''}`
    btn.dataset.tool = t.id
    btn.textContent = t.label
    root.appendChild(btn)
  }
}

mountTools(biomesEl, biomeTools)
mountTools(lifeEl, lifeTools)
mountTools(chaosEl, chaosTools)

const world = new World()
const camera = new Camera(window.innerWidth, window.innerHeight)
camera.centerOn((WORLD_W * TILE) / 2, (WORLD_H * TILE) / 2)
camera.zoom = 0.85

const renderer = new Renderer(canvas)
const state: InputState = {
  tool: 'paint-forest',
  brush: 1,
  paused: false,
  speed: 1,
}

const input = new InputController(canvas, world, camera, state, updateStats)

function setActiveTool(tool: ToolId): void {
  state.tool = tool
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool)
  })
  canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTool(btn.dataset.tool as ToolId))
})

document.querySelector('#btn-pause')!.addEventListener('click', () => {
  state.paused = !state.paused
  document.querySelector('#btn-pause')!.textContent = state.paused ? 'Reanudar' : 'Pausa'
})

document.querySelector('#btn-new')!.addEventListener('click', () => {
  world.generate(Math.floor(Math.random() * 1e9))
  updateStats()
})

document.querySelector<HTMLInputElement>('#brush')!.addEventListener('input', (e) => {
  state.brush = Number((e.target as HTMLInputElement).value)
})

document.querySelector<HTMLInputElement>('#speed')!.addEventListener('input', (e) => {
  state.speed = Number((e.target as HTMLInputElement).value)
})

setActiveTool('paint-forest')

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  camera.resize(window.innerWidth, window.innerHeight)
  renderer.resize(window.innerWidth, window.innerHeight, dpr)
}

window.addEventListener('resize', resize)
resize()

function updateStats(): void {
  const { human, rabbit, wolf } = world.population
  statsEl.innerHTML = `
    <span>Tick <strong>${world.tick}</strong></span>
    <span>Fuego <strong>${world.fires.length}</strong></span>
    <span>Humanos <strong>${human}</strong></span>
    <span>Conejos <strong>${rabbit}</strong></span>
    <span>Lobos <strong>${wolf}</strong></span>
  `
}

let last = performance.now()
let acc = 0

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  if (!state.paused && state.speed > 0) {
    acc += dt * state.speed
    while (acc >= 1 / 20) {
      simulate(world, 1 / 20)
      acc -= 1 / 20
    }
  }

  renderer.draw(world, camera, input.hover, state.brush)
  if (now % 200 < 20) updateStats()
  requestAnimationFrame(frame)
}

updateStats()
requestAnimationFrame(frame)

// Prevent context menu on canvas for middle/right pan
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
