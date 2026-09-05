export class Camera {
  x = 0
  y = 0
  zoom = 1
  minZoom = 0.35
  maxZoom = 3.5
  viewW: number
  viewH: number

  constructor(viewW: number, viewH: number) {
    this.viewW = viewW
    this.viewH = viewH
  }

  resize(w: number, h: number): void {
    this.viewW = w
    this.viewH = h
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    }
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    }
  }

  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom
    this.y -= dy / this.zoom
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy)
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor))
    const after = this.screenToWorld(sx, sy)
    this.x += before.x - after.x
    this.y += before.y - after.y
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx
    this.y = wy
  }
}
