import type { Creature } from './types'

export class SpatialIndex {
  private buckets = new Map<string, Creature[]>()
  rebuild(creatures: Creature[]): void {
    this.buckets.clear()
    for (const creature of creatures) {
      if (creature.life <= 0) continue
      const key = `${Math.floor(creature.x / 8)},${Math.floor(creature.y / 8)}`
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(creature)
      else this.buckets.set(key, [creature])
    }
  }
  nearby(x: number, y: number, radius: number): Creature[] {
    const result: Creature[] = []
    for (let by = Math.floor((y - radius) / 8); by <= Math.floor((y + radius) / 8); by++) {
      for (let bx = Math.floor((x - radius) / 8); bx <= Math.floor((x + radius) / 8); bx++) {
        for (const c of this.buckets.get(`${bx},${by}`) ?? []) {
          if (c.life > 0 && (c.x - x) ** 2 + (c.y - y) ** 2 <= radius ** 2) result.push(c)
        }
      }
    }
    return result
  }
}
