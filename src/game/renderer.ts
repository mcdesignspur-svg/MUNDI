import type { Camera } from './camera'
import type { GameState } from './commands'
import { seedNumber, tileNoise } from './random'
import { CHUNK, TILE, type World } from './world'
import type { Biome } from './types'

const COLORS: Record<Biome, string> = {
  deepWater: '#164858', water: '#297987', sand: '#d5bc7b', grass: '#6d994e',
  forest: '#537c3d', mountain: '#7a8577', snow: '#dce6cf', ash: '#626351', lava: '#c05e31',
}
type Sprite = { canvas: HTMLCanvasElement; w: number; h: number }

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement
  private terrain = new Map<number, { version: number; canvas: HTMLCanvasElement }>()
  private sprites: Sprite[] = []
  private owner?: World
  private time = 0
  ready = false
  reducedMotion = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })!
  }
  async load(): Promise<void> {
    const image = new Image()
    image.src = '/assets/mundi-atlas.png'
    await image.decode()
    // Atlas row gutters follow the generated asset; trim only transparent margins.
    const rows = [0, 0.26, 0.5, 0.704, 1]
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const source = document.createElement('canvas')
      const sx = Math.round(col * image.width / 4), sy = Math.round(rows[row] * image.height)
      source.width = Math.round(image.width / 4)
      source.height = Math.round((rows[row + 1] - rows[row]) * image.height)
      const context = source.getContext('2d')!
      context.drawImage(image, sx, sy, source.width, source.height, 0, 0, source.width, source.height)
      const pixels = context.getImageData(0, 0, source.width, source.height).data
      let left = source.width, top = source.height, right = 0, bottom = 0
      for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        if (pixels[(y * source.width + x) * 4 + 3] > 100) {
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
        }
      }
      const sprite = document.createElement('canvas')
      sprite.width = 32; sprite.height = 32
      const sc = sprite.getContext('2d')!
      sc.imageSmoothingEnabled = false
      const w = right - left + 1, h = bottom - top + 1
      const scale = 30 / Math.max(w, h)
      const dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale))
      sc.drawImage(source, left, top, w, h, Math.floor((32 - dw) / 2), 32 - dh, dw, dh)
      this.sprites.push({ canvas: sprite, w: dw, h: dh })
    }
    this.ready = true; this.terrain.clear()
  }
  resize(w: number, h: number, dpr: number): void {
    if (this.canvas.width === Math.floor(w * dpr) && this.canvas.height === Math.floor(h * dpr)) return
    this.canvas.width = Math.floor(w * dpr); this.canvas.height = Math.floor(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.imageSmoothingEnabled = false
  }
  private sprite(ctx: CanvasRenderingContext2D, index: number, x: number, y: number, size: number, flip = false): void {
    const sprite = this.sprites[index]
    if (!sprite) return
    ctx.save()
    ctx.translate(Math.round(x), Math.round(y))
    if (flip) ctx.scale(-1, 1)
    ctx.drawImage(sprite.canvas, -size / 2, -size, size, size)
    ctx.restore()
  }
  private chunk(world: World, cx: number, cy: number): HTMLCanvasElement {
    const index = cy * 6 + cx, version = world.terrainVersions[index]
    const cached = this.terrain.get(index)
    if (cached?.version === version) return cached.canvas
    const canvas = cached?.canvas ?? document.createElement('canvas')
    canvas.width = CHUNK * TILE; canvas.height = CHUNK * TILE
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const seed = seedNumber(world.seed)
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
      const x = cx * CHUNK + lx, y = cy * CHUNK + ly, b = world.get(x, y)
      const px = lx * TILE, py = ly * TILE
      const noise = tileNoise(x, y, seed)
      ctx.fillStyle = COLORS[b]
      if (b === 'grass' && world.vegetationAt(x, y) < 40) ctx.fillStyle = '#a29b57'
      ctx.fillRect(px, py, TILE, TILE)
      // Deterministic flecks break up flat fields without a checkerboard.
      if (b !== 'water' && b !== 'deepWater') {
        ctx.fillStyle = noise > 0.5 ? '#ffffff0c' : '#142c2410'
        ctx.fillRect(px + Math.floor(noise * 11), py + Math.floor(noise * 7), 5, 2)
        if (b === 'grass' && noise > 0.7) {
          ctx.fillStyle = world.vegetationAt(x, y) > 60 ? '#aec570' : '#beb674'
          ctx.fillRect(px + 10, py + 8, 1, 3); ctx.fillRect(px + 12, py + 10, 2, 1)
        }
      }
      // Neighbor-aware shore edges: turquoise shelf, warm sand, pale surf.
      if (b === 'water' || b === 'deepWater') {
        for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
          const nx = x + dx, ny = y + dy
          const neighbor = world.inBounds(nx, ny) ? world.get(nx, ny) : b
          if (neighbor !== 'water' && neighbor !== 'deepWater') {
            ctx.fillStyle = '#49a299'
            ctx.fillRect(px + (dx === 1 ? 11 : 0), py + (dy === 1 ? 11 : 0), dx ? 5 : TILE, dy ? 5 : TILE)
            ctx.fillStyle = '#bad2a9'
            ctx.fillRect(px + (dx === 1 ? 14 : 0), py + (dy === 1 ? 14 : 0), dx ? 2 : TILE, dy ? 2 : TILE)
          }
        }
      }
      if (b === 'sand' && noise > 0.93) { ctx.fillStyle = '#ecdaa3'; ctx.fillRect(px + 3, py + 9, 3, 1) }
    }
    this.terrain.set(index, { version, canvas })
    return canvas
  }
  draw(world: World, camera: Camera, hover: { x: number; y: number } | null, state: GameState, dt: number): void {
    if (this.owner !== world) { this.owner = world; this.terrain.clear() }
    if (!state.paused && !this.reducedMotion) this.time += dt
    const ctx = this.ctx
    ctx.fillStyle = '#123b49'; ctx.fillRect(0, 0, camera.viewW, camera.viewH)
    ctx.save()
    ctx.translate(camera.viewW / 2, camera.viewH / 2)
    ctx.scale(camera.zoom, camera.zoom)
    ctx.translate(-camera.x, -camera.y)
    const left = Math.max(0, Math.floor((camera.x - camera.viewW / 2 / camera.zoom) / TILE) - 2)
    const top = Math.max(0, Math.floor((camera.y - camera.viewH / 2 / camera.zoom) / TILE) - 2)
    const right = Math.min(96, Math.ceil((camera.x + camera.viewW / 2 / camera.zoom) / TILE) + 2)
    const bottom = Math.min(96, Math.ceil((camera.y + camera.viewH / 2 / camera.zoom) / TILE) + 2)
    for (let cy = Math.floor(top / CHUNK); cy < Math.ceil(bottom / CHUNK); cy++) {
      for (let cx = Math.floor(left / CHUNK); cx < Math.ceil(right / CHUNK); cx++) ctx.drawImage(this.chunk(world, cx, cy), cx * CHUNK * TILE, cy * CHUNK * TILE)
    }
    const seed = seedNumber(world.seed)
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const b = world.get(x, y), n = tileNoise(x, y, seed)
      if ((b === 'water' || b === 'deepWater') && n > 0.97) {
        ctx.fillStyle = '#84bbb140'
        const offset = Math.floor(Math.sin(this.time + n * 100) * 2)
        ctx.fillRect(x * TILE + 4 + offset, y * TILE + 8, 6, 1)
      }
    }
    // Painter order prevents trees in front of a creature from rendering behind it.
    const entities: { y: number; draw: () => void }[] = []
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const b = world.get(x, y), n = tileNoise(x, y, seed)
      const sprite = b === 'forest' && n > 0.45 ? (n > 0.75 ? 13 : 12) :
        (b === 'mountain' || b === 'snow') && n > 0.6 ? 14 : b === 'grass' && n > 0.985 ? 15 : -1
      if (sprite >= 0) entities.push({ y: y + 1, draw: () => {
        ctx.fillStyle = '#112d2530'
        ctx.fillRect(x * TILE + 2, y * TILE + 12, 16, 4)
        this.sprite(ctx, sprite, x * TILE + 8, y * TILE + 16, sprite === 14 ? 23 : 32)
      } })
    }
    for (const c of world.creatures) {
      if (c.x < left || c.x > right || c.y < top || c.y > bottom) continue
      entities.push({ y: c.y, draw: () => {
        const moving = !['eating', 'resting'].includes(c.activity)
        const frame = this.reducedMotion ? 0 : moving
          ? Math.floor(this.time * (c.kind === 'rabbit' ? 9 : 6) + c.id * 0.37) % 4
          : (Math.floor(this.time * 2 + c.id) % 5 === 0 ? 1 : 0)
        const row = c.kind === 'human' ? 0 : c.kind === 'rabbit' ? 1 : 2
        const size = c.kind === 'human' ? 25 : c.kind === 'rabbit' ? 18 : 27
        const px = c.x * TILE
        const bob = this.reducedMotion ? 0 : moving ? Math.round(Math.sin(this.time * 12 + c.id) * 0.7) : Math.round(Math.sin(this.time * 2 + c.id) * 0.4)
        const py = c.y * TILE + bob
        ctx.fillStyle = '#12282050'; ctx.fillRect(px - 5, py - 1, 10, 3)
        this.sprite(ctx, row * 4 + frame, px, py, size, c.vx < 0)
        if (state.selection?.kind === 'creature' && state.selection.id === c.id) {
          ctx.strokeStyle = '#f1cf80'; ctx.lineWidth = 1.5 / camera.zoom
          ctx.strokeRect(px - 12, py - size, 24, size + 3)
        }
        if (c.activity === 'fleeing' || c.energy < 20) {
          ctx.fillStyle = '#f5b377'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText('!', px, py - size - 2)
        }
      } })
    }
    entities.sort((a, b) => a.y - b.y)
    for (const entity of entities) entity.draw()
    for (const f of world.fires) {
      if (f.x < left || f.x > right || f.y < top || f.y > bottom) continue
      const h = 7 + Math.floor(Math.sin(world.tick * 0.3 + f.x) * 3)
      ctx.fillStyle = '#db7034'; ctx.fillRect(f.x * TILE + 4, f.y * TILE + 12 - h, 9, h)
      ctx.fillStyle = '#f4cc72'; ctx.fillRect(f.x * TILE + 7, f.y * TILE + 9 - h, 3, h)
      ctx.fillStyle = '#39443c70'; ctx.fillRect(f.x * TILE + 5, f.y * TILE - 5 - h, 6, 6)
    }
    for (const m of world.meteors) {
      ctx.strokeStyle = '#ffe6ac'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(m.x * TILE, m.y * TILE, m.age * 80 + 5, 0, Math.PI * 2); ctx.stroke()
    }
    for (const rain of world.rainEffects) {
      ctx.strokeStyle = '#bcdfebaa'; ctx.lineWidth = 1
      for (let i = 0; i < 20; i++) {
        const n = tileNoise(i, Math.floor(rain.x), seed)
        const px = (rain.x - rain.radius + n * rain.radius * 2) * TILE
        const py = (rain.y - rain.radius + ((i / 20 + rain.age) % 1) * rain.radius * 2) * TILE
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - 2, py + 5); ctx.stroke()
      }
    }
    const tileSelection = state.selection?.kind === 'tile' ? state.selection : null
    if (tileSelection) {
      ctx.strokeStyle = '#f2cd7c'; ctx.lineWidth = 2 / camera.zoom
      ctx.strokeRect(tileSelection.x * TILE, tileSelection.y * TILE, TILE, TILE)
    }
    if (hover && state.tool !== 'pan' && state.tool !== 'inspect') {
      ctx.strokeStyle = '#fff4c3'; ctx.lineWidth = 1.5 / camera.zoom
      ctx.beginPath(); ctx.arc((hover.x + 0.5) * TILE, (hover.y + 0.5) * TILE, (state.brush + 0.5) * TILE, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.restore()
  }
}
