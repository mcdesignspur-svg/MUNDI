import './style.css'
import { Camera } from './game/camera'
import { InputController } from './game/input'
import { Renderer } from './game/renderer'
import { simulate, STEP } from './game/simulation'
import { ACTIVITY_NAMES, ANIMAL_REASON_NAMES, BUILDING_NAMES, DEATH_CAUSE_NAMES, MAX_AGE, MAX_HEALTH, OVERLAY_NAMES, SEASON_NAMES, TASK_NAMES, WEATHER_NAMES, type Biome, type GameCommand, type Overlay, type ToolId } from './game/types'
import { World, TILE } from './game/world'
import { dispatch, type GameState } from './game/commands'
import { snapshot, restore } from './game/snapshot'
import { listWorlds, saveWorld, type SavedWorld, type Slot } from './game/storage'
import { WorldAudio } from './game/audio'

const app = document.querySelector<HTMLDivElement>('#app')!
const icon = (name: string) => {
  const paths: Record<string, string> = {
    inspect: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    pan: '<path d="M8 12V5a2 2 0 0 1 4 0v7-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2"/>',
    save: '<path d="M4 3h13l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4ZM17 8c3 3 3 5 0 8M20 5c5 5 5 9 0 14"/>',
    center: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
    layers: '<path d="m12 3 8 4-8 4-8-4 8-4ZM4 12l8 4 8-4M4 17l8 4 8-4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] ?? '') + '</svg>'
}
const escapeHTML = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const BIOME_NAMES: Record<Biome, string> = { deepWater: 'Océano', water: 'Agua', sand: 'Arena', grass: 'Pradera', forest: 'Bosque', mountain: 'Montaña', snow: 'Nieve', ash: 'Ceniza', lava: 'Lava' }
const KIND_NAMES = { human: 'Humano', rabbit: 'Conejo', wolf: 'Lobo' }
type Tool = { id: ToolId; label: string; glyph?: string; color?: string; sprite?: number }
const groups: Record<string, Tool[]> = {
  terrain: [
    { id: 'paint-deepWater', label: 'Océano', color: '#164858' },
    { id: 'paint-water', label: 'Agua', color: '#297987' },
    { id: 'paint-sand', label: 'Arena', color: '#d5bc7b' },
    { id: 'paint-grass', label: 'Pradera', color: '#6d994e' },
    { id: 'paint-forest', label: 'Bosque', color: '#315c37' },
    { id: 'paint-mountain', label: 'Montaña', color: '#7a8577' },
    { id: 'paint-snow', label: 'Nieve', color: '#dce6cf' },
  ],
  life: [
    { id: 'spawn-human', label: 'Humano', sprite: 0 },
    { id: 'spawn-rabbit', label: 'Conejo', sprite: 1 },
    { id: 'spawn-wolf', label: 'Lobo', sprite: 2 },
  ],
  powers: [
    { id: 'disaster-rain', label: 'Lluvia', glyph: '☂' },
    { id: 'disaster-fire', label: 'Fuego', glyph: '♨' },
    { id: 'disaster-meteor', label: 'Meteorito', glyph: '☄' },
  ],
}
const allTools = Object.values(groups).flat()
app.innerHTML = `
  <header class="topbar">
    <div class="wordmark"><h1>MUNDI<span class="brand-dot">.</span></h1><span class="edition">Un mundo vivo</span></div>
    <div class="world-title"><span class="live-dot"></span><span id="world-name"></span></div>
    <nav class="header-actions" aria-label="Partida">
      <button id="btn-audio" class="icon-button" aria-label="Activar sonido" title="Activar sonido">${icon('sound')}<span id="audio-off" class="mute-mark"></span></button>
      <button id="btn-library" class="library-button">${icon('save')}<span>Mis mundos</span></button>
    </nav>
  </header>
  <main class="stage" id="stage">
    <canvas id="world" aria-label="Mapa del mundo. Selecciona Inspeccionar para conocer una criatura o una celda."></canvas>
    <div class="world-hud">
      <div class="time-card"><span class="eyebrow">TIEMPO DEL MUNDO</span><strong id="world-time">Día 1 · 00:00</strong><span id="world-status">La vida sigue su curso</span></div>
      <div class="population-card" aria-label="Población del mundo">
        <span><i class="population-dot human"></i>Humanos <strong id="count-human">0</strong></span>
        <span><i class="population-dot rabbit"></i>Conejos <strong id="count-rabbit">0</strong></span>
        <span><i class="population-dot wolf"></i>Lobos <strong id="count-wolf">0</strong></span>
      </div>
    </div>
    <div class="map-navigation" aria-label="Vista del mapa">
      <button id="btn-zoom-in" class="icon-button" aria-label="Acercar mapa">+</button>
      <button id="btn-recenter" class="icon-button" aria-label="Ver el mundo completo" title="Ver el mundo completo">${icon('center')}</button>
      <button id="btn-zoom-out" class="icon-button" aria-label="Alejar mapa">−</button>
      <button id="btn-layers" class="icon-button" aria-label="Mostrar capas del mapa" aria-expanded="false" aria-controls="layers-panel">${icon('layers')}</button>
      <button id="btn-events" class="icon-button" aria-label="Mostrar acontecimientos" aria-expanded="false" aria-controls="events-panel">☷</button>
    </div>
    <div id="layers-panel" class="layers-panel" aria-label="Capas del mapa" hidden>
      <span class="eyebrow">Capas del mapa</span>
      <button data-overlay="none" class="active" aria-pressed="true"><i class="layer-swatch normal"></i>Vista normal</button>
      <button data-overlay="food" aria-pressed="false"><i class="layer-swatch food"></i>Alimento</button>
      <button data-overlay="moisture" aria-pressed="false"><i class="layer-swatch moisture"></i>Humedad</button>
      <button data-overlay="fertility" aria-pressed="false"><i class="layer-swatch fertility"></i>Fertilidad</button>
      <button data-overlay="hazards" aria-pressed="false"><i class="layer-swatch hazards"></i>Peligros</button>
    </div>
    <section id="events-panel" class="events-panel" aria-label="Acontecimientos del mundo" hidden>
      <div class="event-heading"><span class="eyebrow">Pulso del mundo</span><span id="event-count" class="event-count"></span></div>
      <div id="ecosystem-stats" class="ecosystem-stats"></div>
      <div id="event-list" class="event-list"></div>
    </section>
    <div class="map-caption"><span id="world-summary"></span><span class="desktop-hint">Rueda: zoom · Espacio + arrastrar: mover</span></div>
    <div class="loading" id="loading"><strong>Despertando el mundo</strong><span>Preparando el paisaje y sus habitantes…</span></div>
  </main>
  <footer class="dock" id="dock">
    <div class="transport">
      <div class="navigation-tools">
        <button data-tool="inspect" class="mode-button active" aria-pressed="true">${icon('inspect')}<span>Inspeccionar</span></button>
        <button data-tool="pan" class="mode-button" aria-pressed="false">${icon('pan')}<span>Mover</span></button>
      </div>
      <div class="time-controls" aria-label="Velocidad del mundo">
        <button id="btn-pause" aria-label="Pausar mundo" aria-pressed="false"><span id="pause-symbol">Ⅱ</span></button>
        <button data-speed="1" class="active" aria-pressed="true">×1</button>
        <button data-speed="2" aria-pressed="false">×2</button>
        <button data-speed="4" aria-pressed="false">×4</button>
      </div>
      <button id="btn-collapse" class="icon-button collapse-button" aria-label="Ocultar herramientas" aria-expanded="true" aria-controls="tool-body">${icon('chevron')}</button>
    </div>
    <div id="tool-body" class="tool-body">
      <div class="tool-header">
        <div class="category-tabs" role="tablist" aria-label="Herramientas">
          <button role="tab" id="tab-terrain" aria-controls="panel-terrain" aria-selected="true" data-group="terrain" class="active">Terreno</button>
          <button role="tab" id="tab-life" aria-controls="panel-life" aria-selected="false" tabindex="-1" data-group="life">Vida</button>
          <button role="tab" id="tab-powers" aria-controls="panel-powers" aria-selected="false" tabindex="-1" data-group="powers">Poderes</button>
        </div>
        <span class="current-tool" id="current-tool">Toca el mundo para descubrirlo</span>
        <label class="brush-control" for="brush"><span>Pincel <output id="brush-value">2</output></span><input id="brush" type="range" min="0" max="5" value="1" aria-label="Tamaño del pincel" /></label>
      </div>
      <div id="panels">${Object.entries(groups).map(([group, tools]) => `
        <div class="tool-grid" id="panel-${group}" role="tabpanel" aria-labelledby="tab-${group}" ${group === 'terrain' ? '' : 'hidden'}>
          ${tools.map(t => `<button class="tool" data-tool="${t.id}" aria-pressed="false"><span class="tool-preview" ${t.color ? 'style="--swatch:' + t.color + '"' : ''}>${t.sprite !== undefined ? '<span class="creature-preview row-' + t.sprite + '"></span>' : t.glyph ?? '<span class="terrain-swatch"></span>'}</span><span>${t.label}</span></button>`).join('')}
        </div>`).join('')}
      </div>
    </div>
    <aside class="inspector" id="inspector" aria-label="Inspector del mundo" hidden>
      <div class="inspector-heading"><span class="eyebrow">BAJO LA LUPA</span><button id="btn-close-inspector" class="icon-button" aria-label="Cerrar inspector">${icon('close')}</button></div>
      <div id="inspector-content"></div>
      <button id="btn-follow" class="follow-button" aria-pressed="false">Seguir criatura</button>
    </aside>
  </footer>
  <div id="feedback" class="feedback" role="status" aria-live="polite"></div>
  <dialog id="library" aria-labelledby="library-title">
    <div class="dialog-heading"><div><span class="eyebrow">TU PEQUEÑO UNIVERSO</span><h2 id="library-title">Mis mundos</h2></div><button id="btn-close-library" class="icon-button" aria-label="Cerrar Mis mundos">${icon('close')}</button></div>
    <p class="dialog-intro">Guarda un momento. Vuelve a él cuando quieras.</p>
    <p id="save-status" class="save-status" role="status"></p>
    <div class="save-slots" id="save-slots"></div>
    <div class="file-actions"><button id="btn-export">Exportar partida</button><button id="btn-import">Importar partida</button><input id="import-file" type="file" accept=".json,application/json" hidden /></div>
    <form id="new-world-form" class="new-world-form">
      <h3>Crear otro mundo</h3>
      <label for="seed">Semilla</label><input id="seed" maxlength="64" required value="MUNDI-ALBOR" autocomplete="off" />
      <label class="checkbox-label"><input id="populate" type="checkbox" checked /> Incluir humanos y animales</label>
      <p>Antes de cambiar, conservaremos el mundo abierto en «Mundo anterior».</p>
      <button type="submit" class="primary-button">Crear mundo</button>
    </form>
    <div class="audio-settings"><label for="volume">Volumen ambiente</label><input id="volume" type="range" min="0" max="100" value="30" /><button id="btn-sound-settings">Activar sonido</button></div>
    <p class="storage-note">Guardado en este navegador · Autoguardado cada minuto. Exporta una copia para llevarla a otro dispositivo.</p>
  </dialog>
  <dialog id="confirmation" aria-labelledby="confirm-title"><h2 id="confirm-title">Cambiar de mundo</h2><p id="confirm-message"></p><div class="confirm-actions"><button id="confirm-cancel">Cancelar</button><button id="confirm-accept" class="primary-button">Continuar</button></div></dialog>
`

let world = new World()
world.populate()
const state: GameState = { tool: 'inspect', brush: 1, paused: false, speed: 1, selection: null, overlay: 'none' }
const camera = new Camera(1, 1)
camera.minZoom = 0.15
const canvas = $<HTMLCanvasElement>('world')
const renderer = new Renderer(canvas)
renderer.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const sound = new WorldAudio()
const library = $<HTMLDialogElement>('library')
const confirmation = $<HTMLDialogElement>('confirmation')
let following = false
let collapsed = false
let last = performance.now(), accumulator = 0, hudAt = 0
let lastSavedWorld: World | undefined, lastSavedRevision = -1
let busy = false
let activeGroup = 'terrain'
let saves: SavedWorld[] = []
let feedbackTimer = 0

function feedback(message: string): void {
  $('feedback').textContent = message
  $('feedback').classList.add('visible')
  clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => $('feedback').classList.remove('visible'), 3500)
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la acción.'
function worldTime(tick: number): string {
  const minutes = Math.floor(tick / 20)
  return 'Día ' + (Math.floor(minutes / 1440) + 1) + ' · ' + String(Math.floor(minutes / 60) % 24).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0')
}
function ageText(age: number, kind: keyof typeof MAX_AGE): string {
  const remaining = Math.max(0, Math.round(MAX_AGE[kind] - age))
  return Math.floor(age) + ' min · aprox. ' + remaining + ' min restantes'
}
function fit(): void {
  camera.centerOn(world.width * TILE / 2, world.height * TILE / 2)
  camera.zoom = Math.max(camera.minZoom, Math.min(camera.viewW / (world.width * TILE), camera.viewH / (world.height * TILE)) * 0.94)
}
function focusHabitat(): void {
  camera.centerOn(48 * TILE, 48 * TILE)
  camera.zoom = camera.viewW < 600 ? 0.8 : 1.05
}
function trendText(kind: 'human' | 'rabbit' | 'wolf'): string {
  const trend = world.populationTrend(kind)
  return trend > 0 ? '↑ +' + trend : trend < 0 ? '↓ ' + trend : '→ 0'
}
function eventText(event: typeof world.events[number]): string {
  const creature = event.creature ? KIND_NAMES[event.creature].toLowerCase() : ''
  const amount = event.count > 1 ? ' ×' + event.count : ''
  if (event.kind === 'birth') return 'Nació un ' + creature + amount
  if (event.kind === 'hunt') return 'Cacería: cayó un ' + creature + amount
  if (event.kind === 'death') return (event.cause ? DEATH_CAUSE_NAMES[event.cause] : 'Una criatura murió') + amount
  if (event.kind === 'migration') return 'Migración de ' + creature + amount
  if (event.kind === 'fire') return 'Incendio iniciado' + amount
  return creature ? 'Un ' + creature + ' encontró tierra firme' + amount : 'Una criatura encontró tierra firme' + amount
}
function refreshEvents(): void {
  $('event-count').textContent = world.events.length ? String(world.events.length) + ' recientes' : 'Sin sucesos'
  $('ecosystem-stats').innerHTML = (['human', 'rabbit', 'wolf'] as const).map(kind => `<span><i class="population-dot ${kind}"></i>${KIND_NAMES[kind]} <strong>${world.population[kind]}</strong><b>${trendText(kind)}</b></span>`).join('')
  $('event-list').innerHTML = world.events.length
    ? world.events.map(event => `<button class="event-item" data-event="${event.id}" title="Ver ubicación"><span>${eventText(event)}</span><small>hace ${Math.max(0, Math.floor((world.tick - event.tick) / 20))} min</small></button>`).join('')
    : '<p class="event-empty">El mundo aún no ha registrado acontecimientos.</p>'
}
function refresh(): void {
  $('world-name').textContent = world.seed
  $('world-time').textContent = worldTime(world.tick)
  $('world-status').textContent = state.paused ? 'El mundo está en pausa' : world.fires.length ? world.fires.length + ' focos de fuego' : SEASON_NAMES[world.season()] + ' · ' + WEATHER_NAMES[world.weather]
  for (const kind of ['human', 'rabbit', 'wolf'] as const) $('count-' + kind).textContent = String(world.population[kind])
  $('world-summary').textContent = 'Vegetación ' + world.vegetationLevel() + '% · ' + world.creatures.length + ' seres' + (world.villages.length ? ' · ' + world.villages.length + ' aldea' + (world.villages.length > 1 ? 's' : '') : '') + (state.overlay === 'none' ? '' : ' · Capa: ' + OVERLAY_NAMES[state.overlay])
  $('pause-symbol').textContent = state.paused ? '▶' : 'Ⅱ'
  $('btn-pause').setAttribute('aria-label', state.paused ? 'Reanudar mundo' : 'Pausar mundo')
  $('btn-pause').setAttribute('aria-pressed', String(state.paused))
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(btn => {
    const selected = Number(btn.dataset.speed) === state.speed
    btn.classList.toggle('active', selected); btn.setAttribute('aria-pressed', String(selected))
  })
  refreshEvents()
  updateInspector()
}
function updateInspector(): void {
  const selection = state.selection
  $('inspector').hidden = !selection
  app.classList.toggle('inspecting', !!selection)
  if (!selection) return
  const selectedId = selection.kind === 'creature' ? selection.id : null
  const c = selectedId === null ? undefined : world.creatures.find(c => c.id === selectedId)
  $('btn-follow').hidden = !c
  $('btn-follow').textContent = following ? 'Dejar de seguir' : 'Seguir criatura'
  $('btn-follow').setAttribute('aria-pressed', String(following))
  if (selection.kind === 'creature') {
    if (!c) { $('inspector-content').innerHTML = '<h2>La vida sigue</h2><p>Este ser ya no habita el mundo. Selecciona otro para continuar observando.</p>'; following = false; return }
    const health = Math.max(0, Math.round(c.life / MAX_HEALTH[c.kind] * 100)), hunger = Math.max(0, Math.min(100, Math.round(100 - c.energy)))
    const hungerLabel = hunger < 25 ? 'Saciado' : hunger < 55 ? 'Con hambre' : hunger < 80 ? 'Hambriento' : 'En inanición'
    const village = c.villageId ? world.villages.find(v => v.id === c.villageId) : undefined
    $('inspector-content').innerHTML = `
      <div class="inspector-identity"><span class="portrait row-${c.kind === 'human' ? 0 : c.kind === 'rabbit' ? 1 : 2}"></span><div><h2>${KIND_NAMES[c.kind]}</h2><span class="muted">Habitante #${c.id}</span></div></div>
      <p class="activity"><span class="live-dot"></span>${ACTIVITY_NAMES[c.activity]}${c.kind !== 'human' && c.intentReason && c.intentReason !== 'none' ? ' · ' + ANIMAL_REASON_NAMES[c.intentReason] : ''}</p>
      <div class="vitals"><label>Salud <strong>${health}%</strong><meter min="0" max="100" value="${health}">${health}%</meter></label><label>Hambre <strong>${hunger}% · ${hungerLabel}</strong><meter class="hunger" min="0" max="100" value="${hunger}">${hunger}%</meter></label></div>
      <dl><div><dt>Edad</dt><dd>${ageText(c.age, c.kind)}</dd></div><div><dt>Hábitat</dt><dd>${BIOME_NAMES[world.get(Math.floor(c.x), Math.floor(c.y))]}</dd></div></dl>${village ? `<p class="village-note"><strong>${village.name}</strong>${TASK_NAMES[c.task ?? 'idle']} · Reservas: ${Math.round(village.food)} comida, ${Math.round(village.wood)} madera, ${Math.round(village.stone)} piedra</p>` : ''}
    `
  } else {
    const biome = world.get(selection.x, selection.y), food = Math.round(world.vegetationAt(selection.x, selection.y))
    const loss = world.deaths.find(d => (d.x - selection.x) ** 2 + (d.y - selection.y) ** 2 < 36)
    const lossText = loss ? `<p class="recent-loss"><strong>Última pérdida cerca de aquí</strong>${KIND_NAMES[loss.kind]} #${loss.id} · ${DEATH_CAUSE_NAMES[loss.cause]} · hace ${Math.max(0, Math.floor((world.tick - loss.tick) / 20))} min</p>` : ''
    const moisture = Math.round(world.moistureAt(selection.x, selection.y)), fertility = Math.round(world.fertilityAt(selection.x, selection.y))
    const building = world.buildingAt(selection.x, selection.y)
    const village = building ? world.villages.find(v => v.id === building.villageId) : undefined
    const villageText = building && village ? `<p class="village-note"><strong>${village.name} · ${BUILDING_NAMES[building.type]}</strong>${building.progress < 1 ? 'En construcción: ' + Math.round(building.progress * 100) + '%' : 'Población ' + village.members.length + ' · Comida ' + Math.round(village.food) + ' · Madera ' + Math.round(village.wood) + ' · Piedra ' + Math.round(village.stone)}</p>` : ''
    $('inspector-content').innerHTML = `
      <h2>${BIOME_NAMES[biome]}</h2><p class="muted">Celda ${selection.x + 1}, ${selection.y + 1}</p>
      <dl><div><dt>Vegetación</dt><dd>${food}%</dd></div><div><dt>Humedad</dt><dd>${moisture}%</dd></div><div><dt>Fertilidad</dt><dd>${fertility}%</dd></div><div><dt>Estado</dt><dd>${world.fires.some(f => f.x === selection.x && f.y === selection.y) ? 'En llamas' : WEATHER_NAMES[world.weather]}</dd></div></dl>
      <p>${biome === 'grass' ? 'Los herbívoros se alimentan aquí. La pradera vuelve a crecer con el tiempo.' : biome === 'forest' ? 'Un refugio de árboles. El fuego puede convertirlo en ceniza.' : biome === 'water' || biome === 'deepWater' ? 'Los habitantes terrestres buscan un camino alrededor del agua.' : 'Pinta el terreno o aplica un poder para transformar este lugar.'}</p>${villageText}${lossText}
    `
  }
}
function setTool(tool: ToolId): void {
  input.reset(); state.tool = tool
  if (tool !== 'inspect') { state.selection = null; following = false }
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(btn => {
    const active = btn.dataset.tool === tool
    btn.classList.toggle('active', active); btn.setAttribute('aria-pressed', String(active))
  })
  const label = allTools.find(t => t.id === tool)?.label
  $('current-tool').textContent = tool === 'inspect' ? 'Toca el mundo para descubrirlo' : tool === 'pan' ? 'Arrastra para explorar' : label + ' · Toca o arrastra y suelta'
  canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'inspect' ? 'default' : 'crosshair'
  refresh()
}
function send(command: GameCommand): void {
  const message = dispatch(world, state, command)
  if (message) feedback(message)
  else if (command.type === 'apply' && command.tool !== 'inspect' && command.tool !== 'pan') sound.effect(command.tool.startsWith('disaster-'))
  refresh()
}
const input = new InputController(canvas, camera, state, send)
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool as ToolId)))
function changeGroup(group: string): void {
  activeGroup = group
  document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(btn => {
    const active = btn.dataset.group === group
    btn.classList.toggle('active', active); btn.setAttribute('aria-selected', String(active)); btn.tabIndex = active ? 0 : -1
  })
  for (const key of Object.keys(groups)) $('panel-' + key).hidden = key !== group
}
document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach(btn => {
  btn.addEventListener('click', () => changeGroup(btn.dataset.group!))
  btn.addEventListener('keydown', event => {
    const keys = Object.keys(groups), index = keys.indexOf(activeGroup)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % keys.length
    else if (event.key === 'ArrowLeft') next = (index + keys.length - 1) % keys.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = keys.length - 1
    else return
    event.preventDefault(); changeGroup(keys[next]); $('tab-' + keys[next]).focus()
  })
})
$('btn-collapse').addEventListener('click', () => {
  collapsed = !collapsed
  $('tool-body').hidden = collapsed
  app.classList.toggle('collapsed', collapsed)
  $('btn-collapse').setAttribute('aria-expanded', String(!collapsed))
  $('btn-collapse').setAttribute('aria-label', collapsed ? 'Mostrar herramientas' : 'Ocultar herramientas')
})
$('btn-close-inspector').addEventListener('click', () => { state.selection = null; following = false; refresh() })
$('btn-follow').addEventListener('click', () => { following = !following; updateInspector() })
$('btn-pause').addEventListener('click', () => { send({ type: 'pause', paused: !state.paused }); accumulator = 0 })
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(btn => btn.addEventListener('click', () => { send({ type: 'speed', speed: Number(btn.dataset.speed) as 1 | 2 | 4 }); accumulator = 0 }))
$<HTMLInputElement>('brush').addEventListener('input', e => { state.brush = Number((e.target as HTMLInputElement).value); $('brush-value').textContent = String(state.brush + 1) })
$('btn-recenter').addEventListener('click', () => { following = false; fit() })
$('btn-zoom-in').addEventListener('click', () => camera.zoomAt(camera.viewW / 2, camera.viewH / 2, 1.3))
$('btn-zoom-out').addEventListener('click', () => camera.zoomAt(camera.viewW / 2, camera.viewH / 2, 1 / 1.3))
$('btn-layers').addEventListener('click', () => {
  const panel = $('layers-panel')
  panel.hidden = !panel.hidden
  $('events-panel').hidden = true
  $('btn-layers').setAttribute('aria-expanded', String(!panel.hidden))
  $('btn-layers').setAttribute('aria-label', panel.hidden ? 'Mostrar capas del mapa' : 'Ocultar capas del mapa')
  $('btn-events').setAttribute('aria-expanded', 'false')
})
$('btn-events').addEventListener('click', () => {
  const panel = $('events-panel')
  panel.hidden = !panel.hidden
  $('layers-panel').hidden = true
  $('btn-events').setAttribute('aria-expanded', String(!panel.hidden))
  $('btn-events').setAttribute('aria-label', panel.hidden ? 'Mostrar acontecimientos' : 'Ocultar acontecimientos')
  $('btn-layers').setAttribute('aria-expanded', 'false')
})
$('event-list').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-event]')
  if (!button) return
  const item = world.events.find(item => item.id === Number(button.dataset.event))
  if (!item) return
  state.selection = { kind: 'tile', x: Math.floor(item.x), y: Math.floor(item.y) }
  following = false
  camera.centerOn(item.x * TILE, item.y * TILE)
  $('events-panel').hidden = true
  $('btn-events').setAttribute('aria-expanded', 'false')
  refresh()
})
document.querySelectorAll<HTMLButtonElement>('[data-overlay]').forEach(button => button.addEventListener('click', () => {
  state.overlay = button.dataset.overlay as Overlay
  document.querySelectorAll<HTMLButtonElement>('[data-overlay]').forEach(item => {
    const active = item.dataset.overlay === state.overlay
    item.classList.toggle('active', active)
    item.setAttribute('aria-pressed', String(active))
  })
  refresh()
}))
async function toggleSound(): Promise<void> {
  try {
    await sound.unlock()
    sound.setMuted(!sound.muted)
    $('audio-off').hidden = !sound.muted
    $('btn-audio').setAttribute('aria-label', sound.muted ? 'Activar sonido' : 'Silenciar sonido')
    $('btn-sound-settings').textContent = sound.muted ? 'Activar sonido' : 'Silenciar'
  } catch { feedback('El audio no está disponible en este navegador.') }
}
$('btn-audio').addEventListener('click', () => void toggleSound())
$('btn-sound-settings').addEventListener('click', () => void toggleSound())
$<HTMLInputElement>('volume').addEventListener('input', e => sound.setVolume(Number((e.target as HTMLInputElement).value) / 100))
app.addEventListener('pointerdown', () => { if (!sound.muted) void sound.unlock().catch(() => {}) }, { passive: true })
function resize(): void {
  const rect = $('stage').getBoundingClientRect()
  const w = Math.max(1, Math.floor(rect.width)), h = Math.max(1, Math.floor(rect.height))
  camera.resize(w, h)
  renderer.resize(w, h, Math.min(devicePixelRatio || 1, 2))
}
new ResizeObserver(resize).observe($('stage'))
window.addEventListener('resize', resize)
window.visualViewport?.addEventListener('resize', resize)
document.addEventListener('visibilitychange', () => { last = performance.now(); accumulator = 0; if (document.hidden) sound.suspend() })

function ask(message: string): Promise<boolean> {
  $('confirm-message').textContent = message
  confirmation.showModal()
  return new Promise(resolve => {
    const finish = (answer: boolean) => {
      confirmation.close()
      $('confirm-accept').removeEventListener('click', accept)
      $('confirm-cancel').removeEventListener('click', cancel)
      confirmation.removeEventListener('cancel', cancelEvent)
      resolve(answer)
    }
    const accept = () => finish(true), cancel = () => finish(false)
    const cancelEvent = (event: Event) => { event.preventDefault(); finish(false) }
    $('confirm-accept').addEventListener('click', accept)
    $('confirm-cancel').addEventListener('click', cancel)
    confirmation.addEventListener('cancel', cancelEvent)
  })
}
function slotLabel(slot: Slot): string {
  return slot === 'auto' ? 'Autoguardado' : slot === 'previous' ? 'Mundo anterior' : 'Mundo ' + slot.slice(-1)
}
async function refreshSaves(): Promise<void> {
  saves = await listWorlds()
  $('save-slots').innerHTML = (['slot-1', 'slot-2', 'slot-3', 'auto', 'previous'] as Slot[]).map(slot => {
    const saved = saves.find(s => s.slot === slot)
    const meta = saved ? escapeHTML(saved.data.seed) + ' · ' + new Date(saved.savedAt).toLocaleString('es', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sin partida'
    return '<div class="save-slot"><div><strong>' + slotLabel(slot) + '</strong><span>' + meta + '</span></div><div class="slot-actions">' +
      (slot.startsWith('slot') ? '<button data-save="' + slot + '">Guardar</button>' : '') +
      '<button data-load="' + slot + '" ' + (saved ? '' : 'disabled') + '>Abrir</button></div></div>'
  }).join('')
}
async function withStorage(action: () => Promise<void>): Promise<void> {
  if (busy) return
  busy = true
  library.setAttribute('aria-busy', 'true')
  try { await action() } catch (error) { $('save-status').textContent = errorMessage(error); feedback(errorMessage(error)) }
  finally { busy = false; library.removeAttribute('aria-busy') }
}
function replaceWorld(next: World): void {
  input.reset(); world = next; state.selection = null; following = false; accumulator = 0; last = performance.now()
  focusHabitat(); refresh()
}
async function preserveAndReplace(next: World): Promise<void> {
  await saveWorld('previous', snapshot(world))
  // Persist the replacement before switching, so reload resumes the newly opened world.
  await saveWorld('auto', snapshot(next))
  replaceWorld(next)
  lastSavedWorld = world; lastSavedRevision = world.revision
  library.close()
  feedback('El mundo anterior quedó guardado.')
}
$('btn-library').addEventListener('click', () => {
  input.reset(); library.showModal()
  $('save-status').textContent = 'Leyendo tus mundos…'
  void withStorage(async () => { await refreshSaves(); $('save-status').textContent = 'Tus partidas se conservan en este navegador.' })
})
$('btn-close-library').addEventListener('click', () => { if (!busy) library.close() })
library.addEventListener('cancel', e => { if (busy) e.preventDefault() })
library.addEventListener('close', () => { accumulator = 0; last = performance.now() })
$('save-slots').addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button')
  if (!button || busy) return
  const slot = (button.dataset.save ?? button.dataset.load) as Slot
  const saved = saves.find(s => s.slot === slot)
  void withStorage(async () => {
    if (button.dataset.save) {
      if (saved && !(await ask('¿Reemplazar la partida de «' + slotLabel(slot) + '» por este mundo?'))) return
      await saveWorld(slot, snapshot(world))
      $('save-status').textContent = 'Partida guardada en ' + slotLabel(slot) + '.'
      feedback('Partida guardada.'); await refreshSaves()
    } else if (saved) {
      const next = restore(saved.data)
      if (await ask('¿Abrir «' + slotLabel(slot) + '»? Conservaremos tu mundo abierto en «Mundo anterior».')) await preserveAndReplace(next)
    }
  })
})
$('new-world-form').addEventListener('submit', event => {
  event.preventDefault()
  void withStorage(async () => {
    const seed = $<HTMLInputElement>('seed').value.trim()
    if (!seed) throw new Error('Escribe una semilla para crear el mundo.')
    if (!(await ask('¿Crear un mundo con la semilla «' + seed + '»? Conservaremos tu mundo abierto antes de cambiar.'))) return
    const next = new World(seed)
    if ($<HTMLInputElement>('populate').checked) next.populate()
    await preserveAndReplace(next)
  })
})
$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(snapshot(world))], { type: 'application/json' })
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'mundi-' + world.seed.replace(/[^a-z0-9-]/gi, '-').slice(0, 40) + '.json'
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  feedback('Partida exportada.')
})
$('btn-import').addEventListener('click', () => { if (!busy) $<HTMLInputElement>('import-file').click() })
$<HTMLInputElement>('import-file').addEventListener('change', event => {
  const field = event.target as HTMLInputElement, file = field.files?.[0]
  field.value = ''
  if (!file) return
  void withStorage(async () => {
    if (file.size > 2_000_000) throw new Error('El archivo es demasiado grande. El límite es 2 MB.')
    let data: unknown
    try { data = JSON.parse(await file.text()) } catch { throw new Error('El archivo no contiene una partida JSON válida.') }
    const next = restore(data)
    if (await ask('¿Importar esta partida? Conservaremos tu mundo abierto en «Mundo anterior».')) await preserveAndReplace(next)
  })
})
async function autoSave(): Promise<void> {
  if (busy || document.hidden || library.open || (lastSavedWorld === world && lastSavedRevision === world.revision)) return
  const target = world, revision = world.revision, data = snapshot(world)
  busy = true
  try {
    await saveWorld('auto', data)
    lastSavedWorld = target; lastSavedRevision = revision
  } catch (error) { feedback(errorMessage(error)) }
  finally { busy = false }
}
window.setInterval(() => void autoSave(), 60_000)

function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now
  if (!document.hidden) {
    if (!state.paused && !library.open && !confirmation.open) {
      accumulator += dt * state.speed
      let steps = 0
      while (accumulator >= STEP && steps++ < 8) { simulate(world); accumulator -= STEP }
      // Cap catch-up rather than freezing on a slow device.
      accumulator = Math.min(accumulator, STEP * 8)
    } else accumulator = 0
    if (following && state.selection?.kind === 'creature') {
      const id = state.selection.id, c = world.creatures.find(c => c.id === id)
      if (c) camera.centerOn(c.x * TILE, c.y * TILE)
    }
    renderer.draw(world, camera, input.hover, state, dt)
    if (now - hudAt > 300) { hudAt = now; refresh() }
  }
  requestAnimationFrame(frame)
}
async function start(): Promise<void> {
  resize(); focusHabitat(); refresh()
  try {
    const results = await Promise.allSettled([renderer.load(), listWorlds()])
    if (results[0].status === 'rejected') throw new Error('No se pudo cargar el atlas. Recarga la página para volver a intentarlo.')
    if (results[1].status === 'fulfilled') {
      const saved = results[1].value.find(s => s.slot === 'auto')
      if (saved) {
        try { replaceWorld(restore(saved.data)); lastSavedWorld = world; lastSavedRevision = world.revision; feedback('Tu mundo continúa desde el último autoguardado.') }
        catch { feedback('El autoguardado no es compatible. Puedes importar una copia desde Mis mundos.') }
      }
    } else feedback('El guardado local no está disponible. Usa Exportar para conservar tu partida.')
    $('loading').hidden = true
    last = performance.now()
    requestAnimationFrame(frame)
  } catch (error) {
    $('loading').innerHTML = '<strong>No pudimos abrir el mundo</strong><span>' + escapeHTML(errorMessage(error)) + '</span><button id="btn-retry">Reintentar</button>'
    $('btn-retry').addEventListener('click', () => location.reload())
  }
}
void start()
