import type { Village } from '../types'
import { hostility, type FactionState } from './faction'

/** Political influence field for debug overlays — decays with distance, boosted by war. */
export class InfluenceMap {
  width = 0
  height = 0
  field = new Float32Array(0)
  owner = new Int16Array(0)

  ensure(width: number, height: number): void {
    if (this.width === width && this.height === height) return
    this.width = width
    this.height = height
    this.field = new Float32Array(width * height)
    this.owner = new Int16Array(width * height)
  }

  rebuild(width: number, height: number, villages: Village[], factions: FactionState): void {
    this.ensure(width, height)
    this.field.fill(0)
    this.owner.fill(0)
    const radius = 28
    for (const village of villages) {
      const warBoost = villages.some(o => o.id !== village.id && hostility(factions, village.id, o.id) >= 55) ? 1.25 : 1
      const power = (8 + village.members.length * 1.2 + village.food * 0.05) * warBoost
      const minX = Math.max(0, village.x - radius)
      const maxX = Math.min(width - 1, village.x + radius)
      const minY = Math.max(0, village.y - radius)
      const maxY = Math.min(height - 1, village.y + radius)
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const d = Math.hypot(x - village.x, y - village.y)
          if (d > radius) continue
          const influence = power * (1 - d / radius) ** 2
          const i = y * width + x
          if (influence > this.field[i]!) {
            this.field[i] = influence
            this.owner[i] = village.id
          }
        }
      }
    }
  }

  at(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    return this.field[y * this.width + x]!
  }

  ownerAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    return this.owner[y * this.width + x]!
  }
}

export const sharedInfluence = new InfluenceMap()
