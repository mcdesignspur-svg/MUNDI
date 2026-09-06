import type { Biome, CreatureKind, GameCommand, Overlay, Selection, ToolId } from './types'
import type { World } from './world'

export interface GameState {
  tool: ToolId
  brush: number
  paused: boolean
  speed: 1 | 2 | 4
  selection: Selection
  overlay: Overlay
}

export function dispatch(world: World, state: GameState, command: GameCommand): string | undefined {
  if (command.type === 'pause') { state.paused = command.paused; return }
  if (command.type === 'speed') { state.speed = command.speed; return }
  if (!world.inBounds(command.x, command.y)) return 'Elige un lugar dentro del mundo.'
  if (command.type === 'select' || command.tool === 'inspect') {
    const candidates = world.spatial.nearby(command.x + 0.5, command.y + 0.5, 1.8)
    candidates.sort((a, b) => (a.x - command.x - 0.5) ** 2 + (a.y - command.y - 0.5) ** 2 - (b.x - command.x - 0.5) ** 2 - (b.y - command.y - 0.5) ** 2)
    state.selection = candidates[0] ? { kind: 'creature', id: candidates[0].id } : { kind: 'tile', x: command.x, y: command.y }
    return
  }
  const { tool, x, y, radius } = command
  if (tool.startsWith('paint-')) world.paintBrush(x, y, tool.slice(6) as Biome, radius)
  else if (tool.startsWith('spawn-')) {
    const c = world.spawn(tool.slice(6) as CreatureKind, x, y)
    if (!c) return world.creatures.length >= 300 ? 'Este mundo alcanzó el límite de 300 seres.' : 'La vida necesita tierra firme.'
    world.spatial.rebuild(world.creatures)
  } else if (tool === 'disaster-fire') world.ignite(x, y, radius)
  else if (tool === 'disaster-meteor') world.meteor(x, y)
  else if (tool === 'disaster-rain') world.rain(x, y, Math.max(3, radius + 2))
}
