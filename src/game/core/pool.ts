/** Zero-allocation-friendly object pool for transient sim entities. */

export class ObjectPool<T> {
  private free: T[] = []
  private readonly factory: () => T
  private readonly reset: (item: T) => void
  readonly capacity: number
  live = 0

  constructor(factory: () => T, reset: (item: T) => void, capacity = 256) {
    this.factory = factory
    this.reset = reset
    this.capacity = capacity
    for (let i = 0; i < Math.min(32, capacity); i++) this.free.push(factory())
  }

  acquire(): T | null {
    if (this.live >= this.capacity) return null
    const item = this.free.pop() ?? this.factory()
    this.live++
    return item
  }

  release(item: T): void {
    this.reset(item)
    if (this.free.length < this.capacity) this.free.push(item)
    this.live = Math.max(0, this.live - 1)
  }

  drain(items: T[]): void {
    for (const item of items) this.release(item)
    items.length = 0
  }
}
