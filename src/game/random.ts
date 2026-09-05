/** Serializable PRNG. Rendering must never consume the simulation's random stream. */
export class Random {
  state: number
  constructor(seed: number) { this.state = seed >>> 0 }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seedNumber(seed: string): number {
  let value = 2166136261
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  return value >>> 0
}

export function tileNoise(x: number, y: number, seed: number): number {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
