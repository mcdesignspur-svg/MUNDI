import type { Camera } from './camera'
import type { GameState } from './commands'
import type { GameCommand } from './types'
import { TILE } from './world'

export class InputController {
  hover: { x: number; y: number } | null = null
  private canvas: HTMLCanvasElement
  private camera: Camera
  private state: GameState
  private send: (command: GameCommand) => void
  private pointers = new Map<number, { x: number; y: number }>()
  private panning = false
  private gesture = false
  private space = false
  private last = { x: 0, y: 0 }
  private pinchDistance = 0
  private stroke: { x: number; y: number }[] = []
  private strokeKeys = new Set<string>()
  private downTool: GameState['tool'] = 'inspect'

  constructor(canvas: HTMLCanvasElement, camera: Camera, state: GameState, send: (command: GameCommand) => void) {
    this.canvas = canvas; this.camera = camera; this.state = state; this.send = send
    canvas.addEventListener('pointerdown', this.down)
    canvas.addEventListener('pointermove', this.move)
    canvas.addEventListener('pointerup', this.up)
    canvas.addEventListener('pointercancel', this.cancel)
    canvas.addEventListener('lostpointercapture', e => { if (this.pointers.has(e.pointerId)) this.reset() })
    canvas.addEventListener('pointerleave', () => { if (!this.pointers.size) this.hover = null })
    canvas.addEventListener('contextmenu', e => e.preventDefault())
    canvas.addEventListener('wheel', e => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      camera.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-Math.sign(e.deltaY) * 0.12))
    }, { passive: false })
    window.addEventListener('keydown', e => {
      if (e.target instanceof Element && e.target.closest('input, button, select, textarea, dialog')) return
      if (e.code === 'Space') { e.preventDefault(); this.space = true }
    })
    window.addEventListener('keyup', e => { if (e.code === 'Space') this.space = false })
    window.addEventListener('blur', () => { this.space = false; this.reset() })
  }
  private point(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  private tile(p: { x: number; y: number }): { x: number; y: number } {
    const world = this.camera.screenToWorld(p.x, p.y)
    return { x: Math.floor(world.x / TILE), y: Math.floor(world.y / TILE) }
  }
  private apply(p: { x: number; y: number }): void {
    this.send({ type: 'apply', tool: this.downTool, x: p.x, y: p.y, radius: this.state.brush })
  }
  private continuous(): boolean {
    return this.downTool.startsWith('paint-') || this.downTool === 'disaster-fire' || this.downTool === 'disaster-rain'
  }
  private remember(p: { x: number; y: number }): void {
    const key = p.x + ',' + p.y
    if (!this.strokeKeys.has(key) && this.stroke.length < 9216) {
      this.strokeKeys.add(key); this.stroke.push(p)
    }
  }
  private down = (e: PointerEvent): void => {
    e.preventDefault()
    const p = this.point(e)
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, p)
    if (this.pointers.size >= 2) {
      this.gesture = true; this.panning = true; this.stroke = []; this.strokeKeys.clear()
      const [a, b] = [...this.pointers.values()]
      this.last = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y)
      return
    }
    this.last = p; this.downTool = this.state.tool
    this.panning = this.downTool === 'pan' || this.space || e.button === 1 || e.button === 2
    this.hover = this.tile(p)
    if (this.panning) { this.canvas.style.cursor = 'grabbing'; return }
    if (e.pointerType === 'touch') this.remember(this.hover)
    else this.apply(this.hover)
  }
  private move = (e: PointerEvent): void => {
    const p = this.point(e), active = this.pointers.has(e.pointerId)
    this.hover = this.tile(p)
    if (!active) return
    this.pointers.set(e.pointerId, p)
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (this.pinchDistance > 0 && distance > 0) this.camera.zoomAt(mid.x, mid.y, distance / this.pinchDistance)
      this.camera.pan(mid.x - this.last.x, mid.y - this.last.y)
      this.last = mid; this.pinchDistance = distance; this.hover = null
      return
    }
    if (this.panning || this.gesture) {
      this.camera.pan(p.x - this.last.x, p.y - this.last.y); this.last = p; return
    }
    if (this.continuous()) {
      if (e.pointerType === 'touch') this.remember(this.hover)
      else this.apply(this.hover)
    }
  }
  private up = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return
    if (e.pointerType === 'touch' && !this.gesture && !this.panning) {
      if (this.continuous()) { this.remember(this.tile(this.point(e))); for (const p of this.stroke) this.apply(p) }
      else this.apply(this.tile(this.point(e)))
    }
    this.pointers.delete(e.pointerId)
    if (this.pointers.size) { this.last = [...this.pointers.values()][0]; this.gesture = true }
    else this.reset()
  }
  private cancel = (): void => { this.reset() }
  reset(): void {
    const ids = [...this.pointers.keys()]
    this.pointers.clear()
    for (const id of ids) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id)
    this.stroke = []; this.strokeKeys.clear()
    this.panning = false; this.gesture = false; this.pinchDistance = 0; this.hover = null
    this.canvas.style.cursor = this.state.tool === 'pan' ? 'grab' : this.state.tool === 'inspect' ? 'default' : 'crosshair'
  }
}
