/** Typed pub/sub bus for cascading simulation emergence without God-object wiring. */

export type SimEventMap = {
  drought: { severity: number }
  flood: { x: number; y: number; tiles: number }
  freeze: { tiles: number }
  fire: { x: number; y: number }
  crop_failure: { villageId: number; loss: number }
  resource_deficit: { villageId: number; resource: 'food' | 'wood' | 'stone'; amount: number }
  trade_disrupted: { routeId: number; reason: 'war' | 'monster' | 'terrain' | 'intercept' }
  grievance: { fromId: number; toId: number; kind: CasusBelli; amount: number }
  war_declared: { a: number; b: number; casus: CasusBelli }
  peace: { a: number; b: number }
  succession: { villageId: number; rulerId: number; contested: boolean }
  civil_war: { villageId: number }
  culture_shift: { villageId: number; trait: string }
  prophecy_fired: { id: string; action: string }
  founding: { villageId: number; x: number; y: number }
  raid: { attackerId: number; defenderId: number }
  marriage_alliance: { a: number; b: number }
  route_opened: { routeId: number; fromId: number; toId: number }
  route_closed: { routeId: number }
}

export type CasusBelli =
  | 'border_friction'
  | 'resource_starvation'
  | 'cultural_resentment'
  | 'religious_rivalry'
  | 'dynastic_claim'
  | 'raid_revenge'

export type SimEventKind = keyof SimEventMap
export type SimEvent = {
  [K in SimEventKind]: { kind: K; tick: number; payload: SimEventMap[K] }
}[SimEventKind]
type Handler<K extends SimEventKind> = (event: Extract<SimEvent, { kind: K }>) => void

export class EventBus {
  private listeners = new Map<SimEventKind, Set<Handler<SimEventKind>>>()
  private anyListeners = new Set<(event: SimEvent) => void>()

  on<K extends SimEventKind>(kind: K, handler: Handler<K>): () => void {
    let set = this.listeners.get(kind)
    if (!set) {
      set = new Set()
      this.listeners.set(kind, set)
    }
    const wrapped = handler as unknown as Handler<SimEventKind>
    set.add(wrapped)
    return () => set!.delete(wrapped)
  }

  onAny(handler: (event: SimEvent) => void): () => void {
    this.anyListeners.add(handler)
    return () => this.anyListeners.delete(handler)
  }

  emit<K extends SimEventKind>(kind: K, tick: number, payload: SimEventMap[K]): void {
    const event = { kind, tick, payload } as Extract<SimEvent, { kind: K }>
    const set = this.listeners.get(kind)
    if (set) for (const handler of set) handler(event as SimEvent)
    for (const handler of this.anyListeners) handler(event)
  }

  clear(): void {
    this.listeners.clear()
    this.anyListeners.clear()
  }
}
