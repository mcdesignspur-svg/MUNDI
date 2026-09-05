import type { Biome, ToolId } from './types'
import type { Camera } from './camera'
import { TILE, type World } from './world'

export interface InputState {
  tool: ToolId
  brush: number
  paused: boolean
  speed: number
}

function paintBiome(tool: ToolId): Biome | null {
  if (!tool.startsWith('paint-')) return null
  return tool.slice(6) as Biome
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export class InputController {
  hover: { x: number; y: number } | null = null
  private dragging = false
  private panning = false
  private lastX = 0
  private lastY = 0
  private spaceDown = false
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchStartDist = 0
  private pinchStartZoom = 1
  private canvas: HTMLCanvasElement
  private world: World
  private camera: Camera
  private state: InputState
  private onChange: () => void

  constructor(
    canvas: HTMLCanvasElement,
    world: World,
    camera: Camera,
    state: InputState,
    onChange: () => void,
  ) {
    this.canvas = canvas
    this.world = world
    this.camera = camera
    this.state = state
    this.onChange = onChange
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private tile(e: PointerEvent): { x: number; y: number } {
    const p = this.local(e)
    const w = this.camera.screenToWorld(p.x, p.y)
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) }
  }

  private apply(tx: number, ty: number): void {
    const { tool, brush } = this.state
    const biome = paintBiome(tool)
    if (biome) {
      this.world.paintBrush(tx, ty, biome, brush)
      this.onChange()
      return
    }
    if (tool === 'spawn-human') this.world.spawn('human', tx, ty)
    else if (tool === 'spawn-rabbit') this.world.spawn('rabbit', tx, ty)
    else if (tool === 'spawn-wolf') this.world.spawn('wolf', tx, ty)
    else if (tool === 'disaster-fire') this.world.ignite(tx, ty, brush)
    else if (tool === 'disaster-meteor') this.world.meteor(tx, ty)
    else if (tool === 'disaster-rain') this.world.rain(tx, ty, Math.max(3, brush + 2))
    this.onChange()
  }

  private beginPinch(): void {
    const pts = [...this.pointers.values()]
    if (pts.length < 2) return
    this.pinchStartDist = dist(pts[0]!, pts[1]!)
    this.pinchStartZoom = this.camera.zoom
    this.dragging = false
    this.panning = true
    this.lastX = (pts[0]!.x + pts[1]!.x) / 2
    this.lastY = (pts[0]!.y + pts[1]!.y) / 2
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, this.local(e))
    if (this.pointers.size >= 2) {
      this.beginPinch()
      return
    }
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (this.state.tool === 'pan' || this.spaceDown || e.button === 1 || e.button === 2) {
      this.panning = true
      this.canvas.style.cursor = 'grabbing'
      return
    }
    this.dragging = true
    const t = this.tile(e)
    this.hover = t
    this.apply(t.x, t.y)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const local = this.local(e)
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, local)

    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()]
      const mid = { x: (pts[0]!.x + pts[1]!.x) / 2, y: (pts[0]!.y + pts[1]!.y) / 2 }
      const d = dist(pts[0]!, pts[1]!)
      if (this.pinchStartDist > 0) {
        const ratio = (this.pinchStartZoom * (d / this.pinchStartDist)) / this.camera.zoom
        this.camera.zoomAt(mid.x, mid.y, ratio)
      }
      this.camera.pan(mid.x - this.lastX, mid.y - this.lastY)
      this.lastX = mid.x
      this.lastY = mid.y
      this.hover = null
      return
    }

    this.hover = this.tile(e)
    if (this.panning) {
      this.camera.pan(e.clientX - this.lastX, e.clientY - this.lastY)
      this.lastX = e.clientX
      this.lastY = e.clientY
      return
    }
    if (
      this.dragging &&
      (this.state.tool.startsWith('paint-') ||
        this.state.tool === 'disaster-fire' ||
        this.state.tool === 'disaster-rain')
    ) {
      this.apply(this.hover.x, this.hover.y)
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
    if (this.pointers.size >= 2) {
      this.beginPinch()
      return
    }
    if (this.pointers.size === 1) {
      const p = [...this.pointers.values()][0]!
      const rect = this.canvas.getBoundingClientRect()
      this.lastX = p.x + rect.left
      this.lastY = p.y + rect.top
      this.panning = this.state.tool === 'pan' || this.spaceDown
      this.dragging = !this.panning
      this.pinchStartDist = 0
      return
    }
    this.dragging = false
    this.panning = false
    this.pinchStartDist = 0
    this.canvas.style.cursor = this.state.tool === 'pan' ? 'grab' : 'crosshair'
  }

  private onPointerLeave = (): void => {
    if (this.pointers.size === 0) this.hover = null
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY > 0 ? 0.9 : 1.1)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault()
      this.spaceDown = true
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.spaceDown = false
  }
}
