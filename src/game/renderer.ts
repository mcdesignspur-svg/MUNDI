import { BIOME_COLORS, CREATURE_COLORS } from './types'
import type { Camera } from './camera'
import { TILE, type World } from './world'

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + amount))
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amount))
  const b = Math.min(255, Math.max(0, (n & 255) + amount))
  return `rgb(${r},${g},${b})`
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('No 2d context')
    this.canvas = canvas
    this.ctx = ctx
  }

  resize(w: number, h: number, dpr: number): void {
    this.canvas.width = Math.floor(w * dpr)
    this.canvas.height = Math.floor(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(
    world: World,
    camera: Camera,
    hover: { x: number; y: number } | null,
    brush: number,
  ): void {
    const { ctx } = this
    const w = camera.viewW
    const h = camera.viewH

    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#0c1a24')
    g.addColorStop(1, '#152830')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.scale(camera.zoom, camera.zoom)
    ctx.translate(-camera.x, -camera.y)

    const left = Math.max(0, Math.floor((camera.x - w / 2 / camera.zoom) / TILE) - 1)
    const top = Math.max(0, Math.floor((camera.y - h / 2 / camera.zoom) / TILE) - 1)
    const right = Math.min(world.width, Math.ceil((camera.x + w / 2 / camera.zoom) / TILE) + 1)
    const bottom = Math.min(world.height, Math.ceil((camera.y + h / 2 / camera.zoom) / TILE) + 1)

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const biome = world.get(x, y)
        const px = x * TILE
        const py = y * TILE
        const base = BIOME_COLORS[biome]
        ctx.fillStyle = shade(base, (x + y) % 2 === 0 ? 6 : -4)
        ctx.fillRect(px, py, TILE + 0.5, TILE + 0.5)

        if (biome === 'forest') {
          ctx.fillStyle = shade(base, -25)
          ctx.beginPath()
          ctx.moveTo(px + 6, py + 2)
          ctx.lineTo(px + 10, py + 9)
          ctx.lineTo(px + 2, py + 9)
          ctx.fill()
        } else if (biome === 'mountain') {
          ctx.fillStyle = shade(base, 28)
          ctx.beginPath()
          ctx.moveTo(px + 6, py + 2)
          ctx.lineTo(px + 11, py + 10)
          ctx.lineTo(px + 1, py + 10)
          ctx.fill()
        } else if (biome === 'water' || biome === 'deepWater') {
          if ((x * 3 + y * 7 + world.tick) % 17 === 0) {
            ctx.fillStyle = 'rgba(200,230,255,0.18)'
            ctx.fillRect(px + 3, py + 5, 5, 1.5)
          }
        }
      }
    }

    for (const fire of world.fires) {
      const px = fire.x * TILE
      const py = fire.y * TILE
      const flicker = 0.6 + Math.sin(world.tick * 0.4 + fire.x) * 0.25
      ctx.fillStyle = `rgba(255,${(120 + fire.heat * 40) | 0},40,${flicker})`
      ctx.beginPath()
      ctx.arc(px + 6, py + 6, 3.5 + fire.heat, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(255,220,120,${flicker * 0.8})`
      ctx.beginPath()
      ctx.arc(px + 6, py + 5, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }

    for (const c of world.creatures) {
      const px = c.x * TILE
      const py = c.y * TILE
      ctx.fillStyle = CREATURE_COLORS[c.kind]
      if (c.kind === 'human') {
        ctx.beginPath()
        ctx.arc(px, py - 1, 2.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillRect(px - 1.6, py, 3.2, 4)
      } else if (c.kind === 'rabbit') {
        ctx.beginPath()
        ctx.ellipse(px, py, 2.2, 1.6, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillRect(px - 0.5, py - 3.5, 0.8, 2.2)
        ctx.fillRect(px + 0.8, py - 3.2, 0.7, 2)
      } else {
        ctx.beginPath()
        ctx.ellipse(px, py, 3.2, 1.8, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#2a2c32'
        ctx.beginPath()
        ctx.arc(px + 2.2, py - 0.4, 0.6, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    for (const m of world.meteors) {
      const t = m.age / 0.9
      const r = m.radius * (0.2 + t * 0.8)
      ctx.strokeStyle = `rgba(255,180,80,${1 - t})`
      ctx.lineWidth = 2 / camera.zoom
      ctx.beginPath()
      ctx.arc(m.x * TILE, m.y * TILE, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = `rgba(255,240,200,${(1 - t) * 0.35})`
      ctx.beginPath()
      ctx.arc(m.x * TILE, m.y * TILE, r * 0.35, 0, Math.PI * 2)
      ctx.fill()
    }

    if (hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1.2 / camera.zoom
      ctx.strokeRect(
        (hover.x - brush) * TILE,
        (hover.y - brush) * TILE,
        (brush * 2 + 1) * TILE,
        (brush * 2 + 1) * TILE,
      )
    }

    ctx.restore()
  }
}
