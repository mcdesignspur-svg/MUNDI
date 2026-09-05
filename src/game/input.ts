import type { Biome, ToolId } from './types'
import type { Camera } from './camera'
import { TILE, type World } from './world'

export interface InputState {
  tool: ToolId
  brush: number
  paused: boolean
  speed: number
}

function paintBiomeFromTool(tool: ToolId): Biome | null {
  if (!tool.startsWith('paint-')) return null
  return tool.slice(6) as Biome
}

export class InputController {
  private dragging = false
  private panning = false
  private lastX = 0
  private lastY = 0
  private spaceDown = false
  hover: { x: number; y: number } | null = null
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
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  private tileFromEvent(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const world = this.camera.screenToWorld(sx, sy)
    return {
      x: Math.floor(world.x / TILE),
      y: Math.floor(world.y / TILE),
    }
  }

  private applyTool(tx: number, ty: number): void {
    const { tool, brush } = this.state
    const biome = paintBiomeFromTool(tool)
    if (biome) {
      this.world.paintBrush(tx, ty, biome, brush)
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

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId)
    this.lastX = e.clientX
    this.lastY = e.clientY
    const panMode =
      this.state.tool === 'pan' || this.spaceDown || e.button === 1 || e.button === 2
    if (panMode) {
      this.panning = true
      this.canvas.style.cursor = 'grabbing'
      return
    }
    this.dragging = true
    const t = this.tileFromEvent(e)
    this.hover = t
    this.applyTool(t.x, t.y)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const t = this.tileFromEvent(e)
    this.hover = t

    if (this.panning) {
      this.camera.pan(e.clientX - this.lastX, e.clientY - this.lastY)
      this.lastX = e.clientX
      this.lastY = e.clientY
      return
    }

    if (this.dragging) {
      const tool = this.state.tool
      if (
        tool.startsWith('paint-') ||
        tool === 'disaster-fire' ||
        tool === 'disaster-rain'
      ) {
        this.applyTool(t.x, t.y)
      }
    }
  }

  private onPointerUp = (): void => {
    this.dragging = false
    this.panning = false
    this.canvas.style.cursor = this.state.tool === 'pan' ? 'grab' : 'crosshair'
  }

  private onPointerLeave = (): void => {
    this.hover = null
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    this.camera.zoomAt(sx, sy, factor)
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
