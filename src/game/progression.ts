import {
  KNOWLEDGE_HINTS, KNOWLEDGE_NAMES, TECH_HINTS, TECH_NAMES,
  type BuildingType, type KnowledgeId, type TechId, type Village,
} from './types'

export function hasKnowledge(village: Village, id: KnowledgeId): boolean {
  return village.knowledge.includes(id)
}

export function hasTech(village: Village, id: TechId): boolean {
  return village.tech.includes(id)
}

export function lumberYield(village: Village, hasSawmillBuilding = false): number {
  let amount = 1.1
  if (hasKnowledge(village, 'woodcraft')) amount += 0.45
  if (hasTech(village, 'wood_tools')) amount += 0.55
  if (hasSawmillBuilding || hasTech(village, 'sawmill')) amount += 0.4
  return amount
}

export function stoneYield(village: Village): number {
  let amount = 0.7
  if (hasKnowledge(village, 'stonecraft')) amount += 0.35
  if (hasTech(village, 'stone_tools')) amount += 0.5
  return amount
}

export function berryYield(village: Village): number {
  return hasKnowledge(village, 'foraging') ? 1.35 : 0.9
}

export function huntFoodYield(village: Village): number {
  return hasKnowledge(village, 'hunting') ? 8 : 5
}

export function fishYield(village: Village): number {
  return hasKnowledge(village, 'fishing') ? 2.2 : 1.4
}

export function foodUpkeep(village: Village, members: number): number {
  const base = members * 0.1
  return hasTech(village, 'storehouse') ? base * 0.72 : base
}

export function workSpeed(village: Village, kind: 'lumber' | 'mining' | 'building'): number {
  if (kind === 'lumber') return hasTech(village, 'wood_tools') ? 1.55 : hasKnowledge(village, 'woodcraft') ? 1.2 : 1
  if (kind === 'mining') return hasTech(village, 'stone_tools') ? 1.55 : hasKnowledge(village, 'stonecraft') ? 1.2 : 1
  return hasTech(village, 'wood_tools') ? 1.25 : 1
}

export function huntDamage(village: Village | undefined): number {
  if (!village) return 6
  return hasTech(village, 'stone_tools') ? 11 : hasTech(village, 'wood_tools') ? 8 : 6
}

/** Try to unlock knowledge nodes; returns newly unlocked ids. */
export function evaluateKnowledge(village: Village, fertileNearby: boolean): KnowledgeId[] {
  const unlocked: KnowledgeId[] = []
  const gain = (id: KnowledgeId, ok: boolean) => {
    if (ok && !hasKnowledge(village, id)) { village.knowledge.push(id); unlocked.push(id) }
  }
  gain('foraging', true)
  gain('hunting', village.progress.hunts >= 3)
  gain('fishing', village.progress.fish >= 3)
  gain('woodcraft', village.progress.trees >= 3)
  gain('stonecraft', village.progress.stone >= 3)
  gain('farming', village.food >= 50 && fertileNearby && village.progress.berries + village.progress.hunts + village.progress.fish >= 10)
  gain('firecraft', village.progress.nights >= 6)
  return unlocked
}

/** Try to unlock tech nodes; returns newly unlocked ids. */
export function evaluateTech(village: Village, hasHome: boolean, hasSawmillBuilding: boolean): TechId[] {
  const unlocked: TechId[] = []
  const gain = (id: TechId, ok: boolean) => {
    if (ok && !hasTech(village, id)) { village.tech.push(id); unlocked.push(id) }
  }
  gain('wood_tools', hasKnowledge(village, 'woodcraft') && village.wood >= 16)
  gain('stone_tools', hasKnowledge(village, 'stonecraft') && hasTech(village, 'wood_tools') && village.stone >= 10)
  gain('farm', hasKnowledge(village, 'farming') && hasTech(village, 'wood_tools'))
  gain('sawmill', hasKnowledge(village, 'woodcraft') && hasTech(village, 'wood_tools') && hasHome)
  gain('storehouse', hasTech(village, 'wood_tools') && village.food >= 55)
  // Owning a sawmill building also counts as having the tech idea.
  if (hasSawmillBuilding) gain('sawmill', true)
  return unlocked
}

export function techAllowsBuilding(village: Village, type: BuildingType): boolean {
  if (type === 'home') return true
  if (type === 'storehouse') return hasTech(village, 'storehouse')
  if (type === 'farm') return hasTech(village, 'farm')
  if (type === 'sawmill') return hasTech(village, 'sawmill')
  return false
}

export function syncBuildingQueue(village: Village): void {
  const desired: BuildingType[] = []
  if (!village.buildingQueue.includes('home')) desired.push('home')
  // Always keep home first if not built yet — caller filters by existing buildings.
  const candidates: BuildingType[] = ['home', 'storehouse', 'farm', 'sawmill']
  for (const type of candidates) {
    if (techAllowsBuilding(village, type) && !desired.includes(type)) desired.push(type)
  }
  // Preserve in-progress intent: keep only allowed types, append newly allowed.
  village.buildingQueue = village.buildingQueue.filter(type => techAllowsBuilding(village, type))
  for (const type of desired) {
    if (!village.buildingQueue.includes(type)) village.buildingQueue.push(type)
  }
}

export function nextKnowledgeHint(village: Village): string | null {
  const order: KnowledgeId[] = ['foraging', 'hunting', 'fishing', 'woodcraft', 'stonecraft', 'farming', 'firecraft']
  for (const id of order) {
    if (!hasKnowledge(village, id)) return KNOWLEDGE_NAMES[id] + ': ' + KNOWLEDGE_HINTS[id]
  }
  return null
}

export function nextTechHint(village: Village): string | null {
  const order: TechId[] = ['wood_tools', 'stone_tools', 'storehouse', 'farm', 'sawmill']
  for (const id of order) {
    if (!hasTech(village, id)) return TECH_NAMES[id] + ': ' + TECH_HINTS[id]
  }
  return null
}

export function progressionSummary(village: Village): string {
  const know = village.knowledge.map(id => KNOWLEDGE_NAMES[id]).join(', ') || 'ninguno'
  const tech = village.tech.map(id => TECH_NAMES[id]).join(', ') || 'ninguna'
  const nextK = nextKnowledgeHint(village)
  const nextT = nextTechHint(village)
  return `Saberes: ${know}. Tecnologías: ${tech}.` + (nextK ? ` Próximo saber — ${nextK}.` : '') + (nextT ? ` Próxima tech — ${nextT}.` : '')
}
