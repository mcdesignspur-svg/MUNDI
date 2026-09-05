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
    <button type="button" class="map-action" id="btn-recenter">Centrar mapa</button>
  </aside>
  <p class="hint">Pellizco = zoom · Dos dedos / Mano = pan · Toca = herramienta</p>
  <div class="feedback" id="feedback" role="status" aria-live="polite"></div>
  <div class="toolbar" id="toolbar">
    <div class="mobile-tool-context" id="tool-context" aria-live="polite">
      <span class="tool-context-icon" id="tool-context-icon">🌲</span>
      <div>
        <strong id="tool-context-name">Bosque</strong>
        <p id="tool-context-hint">Toca o arrastra para pintar.</p>
      </div>
    </div>
    <div class="mobile-tabs" id="mobile-tabs" role="tablist" aria-label="Herramientas del mundo">
      <button type="button" data-tab="biomes" class="active" role="tab" aria-selected="true">Biomas</button>
      <button type="button" data-tab="life" role="tab" aria-selected="false">Vida</button>
      <button type="button" data-tab="chaos" role="tab" aria-selected="false">Caos</button>
      <button type="button" data-tab="controls" role="tab" aria-selected="false">Control</button>
    </div>
    <div class="tool-panels" id="tool-panels" data-tab="biomes">
      <div class="tool-row" id="biomes"><div class="label">Biomas</div></div>
      <div class="tool-row" id="life"><div class="label">Vida</div></div>
      <div class="tool-row" id="chaos"><div class="label">Desastres</div></div>
      <div class="controls" id="controls">
        <button type="button" data-tool="pan">Mano</button>
        <button type="button" id="btn-pause">Pausa</button>
        <button type="button" id="btn-new">Nuevo mundo</button>
        <label><span>Pincel <output id="brush-value">Medio</output></span><input id="brush" type="range" min="0" max="5" value="1" /></label>
        <label><span>Velocidad <output id="speed-value">Normal</output></span><input id="speed" type="range" min="0" max="3" step="1" value="1" /></label>
      </div>
    </div>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#world')!
const statsEl = document.querySelector<HTMLDivElement>('#stats')!
const biomesEl = document.querySelector<HTMLDivElement>('#biomes')!
const lifeEl = document.querySelector<HTMLDivElement>('#life')!
const chaosEl = document.querySelector<HTMLDivElement>('#chaos')!
const toolbarEl = document.querySelector<HTMLDivElement>('#toolbar')!
const toolPanels = document.querySelector<HTMLDivElement>('#tool-panels')!
const mobileTabs = document.querySelector<HTMLDivElement>('#mobile-tabs')!
const toolContextIcon = document.querySelector<HTMLSpanElement>('#tool-context-icon')!
const toolContextName = document.querySelector<HTMLElement>('#tool-context-name')!
const toolContextHint = document.querySelector<HTMLParagraphElement>('#tool-context-hint')!
const feedbackEl = document.querySelector<HTMLDivElement>('#feedback')!
const brushValue = document.querySelector<HTMLOutputElement>('#brush-value')!
const speedValue = document.querySelector<HTMLOutputElement>('#speed-value')!

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

const TOOL_DETAILS: Record<ToolId, { icon: string; hint: string }> = {
  pan: { icon: '✋', hint: 'Arrastra el mapa con un dedo.' },
  'paint-deepWater': { icon: '🌊', hint: 'Toca o arrastra para pintar.' },
  'paint-water': { icon: '💧', hint: 'Toca o arrastra para pintar.' },
  'paint-sand': { icon: '🏖️', hint: 'Toca o arrastra para pintar.' },
  'paint-grass': { icon: '🌱', hint: 'Toca o arrastra para pintar.' },
  'paint-forest': { icon: '🌲', hint: 'Toca o arrastra para pintar.' },
  'paint-mountain': { icon: '⛰️', hint: 'Toca o arrastra para pintar.' },
  'paint-snow': { icon: '❄️', hint: 'Toca o arrastra para pintar.' },
  'spawn-human': { icon: '🧑', hint: 'Toca el terreno para crear vida.' },
  'spawn-rabbit': { icon: '🐇', hint: 'Toca el terreno para crear vida.' },
  'spawn-wolf': { icon: '🐺', hint: 'Toca el terreno para crear vida.' },
  'disaster-fire': { icon: '🔥', hint: 'Toca o arrastra para extender fuego.' },
  'disaster-meteor': { icon: '☄️', hint: 'Toca un lugar para impactar.' },
  'disaster-rain': { icon: '🌧️', hint: 'Toca o arrastra para apagar fuego.' },
}

let feedbackTimer: number | undefined

function showFeedback(message: string): void {
  feedbackEl.textContent = message
  feedbackEl.classList.add('show')
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => feedbackEl.classList.remove('show'), 1500)
}

function brushLabel(value: number): string {
  return ['Punto', 'Medio', 'Amplio', 'Grande', 'Enorme', 'Máximo'][value] ?? 'Medio'
}

function speedLabel(value: number): string {
  return ['Detenido', 'Lento', 'Normal', 'Rápido'][value] ?? 'Normal'
}

function mountTools(
  root: HTMLElement,
  tools: { id: ToolId; label: string; cls?: string }[],
): void {
  for (const t of tools) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `tool${t.cls ? ` ${t.cls}` : ''}`
    btn.dataset.tool = t.id
    btn.setAttribute('aria-label', t.label)
    btn.innerHTML = `<span class="tool-icon" aria-hidden="true">${TOOL_DETAILS[t.id].icon}</span><span>${t.label}</span>`
    root.appendChild(btn)
  }
}

mountTools(biomesEl, biomeTools)
mountTools(lifeEl, lifeTools)
mountTools(chaosEl, chaosTools)

mobileTabs.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    toolPanels.dataset.tab = btn.dataset.tab!
    mobileTabs.querySelectorAll('button').forEach((b) => {
      const active = b === btn
      b.classList.toggle('active', active)
      b.setAttribute('aria-selected', String(active))
    })
    syncToolbarSpace()
  })
})

const world = new World()
const camera = new Camera(window.innerWidth, window.innerHeight)
camera.centerOn((WORLD_W * TILE) / 2, (WORLD_H * TILE) / 2)
camera.zoom = window.innerWidth < 720 ? 0.55 : 0.85

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
  const button = document.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)
  const label = button?.querySelector('span:last-child')?.textContent ?? button?.textContent ?? tool
  const detail = TOOL_DETAILS[tool]
  toolContextIcon.textContent = detail.icon
  toolContextName.textContent = label
  toolContextHint.textContent = detail.hint
  canvas.style.cursor = tool === 'pan' ? 'grab' : 'crosshair'
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTool(btn.dataset.tool as ToolId))
})

document.querySelector('#btn-pause')!.addEventListener('click', () => {
  state.paused = !state.paused
  document.querySelector('#btn-pause')!.textContent = state.paused ? 'Reanudar' : 'Pausa'
  showFeedback(state.paused ? 'El mundo está en pausa' : 'El mundo sigue su curso')
})

document.querySelector('#btn-new')!.addEventListener('click', () => {
  world.generate(Math.floor(Math.random() * 1e9))
  updateStats()
  showFeedback('Nuevo mundo creado')
})

document.querySelector('#btn-recenter')!.addEventListener('click', () => {
  camera.centerOn((WORLD_W * TILE) / 2, (WORLD_H * TILE) / 2)
  showFeedback('Vista centrada')
})

document.querySelector<HTMLInputElement>('#brush')!.addEventListener('input', (e) => {
  state.brush = Number((e.target as HTMLInputElement).value)
  brushValue.textContent = brushLabel(state.brush)
})

document.querySelector<HTMLInputElement>('#speed')!.addEventListener('input', (e) => {
  state.speed = Number((e.target as HTMLInputElement).value)
  speedValue.textContent = speedLabel(state.speed)
})

setActiveTool('paint-forest')

function syncToolbarSpace(): void {
  const h = toolbarEl.getBoundingClientRect().height
  document.documentElement.style.setProperty('--toolbar-h', `${Math.ceil(h)}px`)
}

function viewSize(): { w: number; h: number } {
  const vv = window.visualViewport
  return {
    w: Math.floor(vv?.width ?? window.innerWidth),
    h: Math.floor(vv?.height ?? window.innerHeight),
  }
}

function resize(): void {
  const { w, h } = viewSize()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  syncToolbarSpace()
  const toolbarH =
    Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h')) ||
    0
  const stageH = Math.max(120, h - toolbarH)
  camera.resize(w, stageH)
  renderer.resize(w, stageH, dpr)
}

window.addEventListener('resize', resize)
window.visualViewport?.addEventListener('resize', resize)
window.visualViewport?.addEventListener('scroll', resize)
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(toolbarEl)
resize()

function updateStats(): void {
  const { human, rabbit, wolf } = world.population
  const vegetation = world.vegetationLevel()
  statsEl.innerHTML = `
    <span>Tick <strong>${world.tick}</strong></span>
    <span>Verde <strong>${vegetation}%</strong></span>
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
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
