import { failure, type Face, type Meld, type Move, type Result, type Tile } from './protocol'
import { analyzeMeld, couldCompleteMeld } from './melds'

export type Draft = {
  table: Meld[]
  rack: Tile[]
  freedJokers: ReadonlySet<string>
  nextGroupId: number
}

export type TurnRules = {
  opened: boolean
  tableIds: ReadonlySet<string>
  jokers: ReadonlyMap<string, { groupId: number; face: Face }>
}

export function turnRules(table: Meld[], opened: boolean): TurnRules {
  return {
    opened,
    tableIds: new Set(table.flatMap(group => group.tiles.map(tile => tile.id))),
    jokers: new Map(table.flatMap(group => Object.entries(group.jokers)
      .map(([id, face]) => [id, { groupId: group.id, face }] as const))),
  }
}

export function startDraft(table: Meld[], rack: Tile[]): Draft {
  return {
    table,
    rack,
    freedJokers: new Set(),
    nextGroupId: Math.max(0, ...table.map(group => group.id)) + 1,
  }
}

export function lockedFaces(rules: TurnRules, freedJokers: ReadonlySet<string>): ReadonlyMap<string, Face> {
  return new Map([...rules.jokers].flatMap(([id, binding]) => freedJokers.has(id) ? [] : [[id, binding.face]]))
}

export function applyMove(draft: Draft, rules: TurnRules, move: Move): Result<Draft> {
  const sourceGroup = 'tile' in move ? draft.table.find(group => group.tiles.some(tile => tile.id === move.tile)) : undefined
  const ids = 'tile' in move ? [move.tile] : move.tiles
  const source = sourceGroup?.tiles ?? draft.rack
  const available = ids.map(id => source.find(tile => tile.id === id))
  const tiles = available.filter(tile => tile !== undefined)
  const movedIds = new Set(ids)
  if (tiles.length !== ids.length || movedIds.size !== ids.length) return failure('Alguna de las fichas no está disponible.')
  if ('tiles' in move && !analyzeMeld(tiles)) return failure('Selecciona un grupo válido de fichas de tu atril.')
  if (move.anchor && movedIds.has(move.anchor)) return { ok: true, data: draft }

  const targetGroup = draft.table.find(group => group.id === move.to)
  if (typeof move.to === 'number' && !targetGroup) return failure('Ese grupo ya no existe.')
  if (!rules.opened && [sourceGroup, targetGroup].some(group => group?.tiles.some(item => rules.tableIds.has(item.id)))) {
    return failure('Completa tu apertura de 30 puntos antes de tocar los grupos de la mesa.')
  }
  if (move.to === 'rack' && tiles.some(tile => rules.tableIds.has(tile.id))) {
    return failure('Las fichas que ya estaban en la mesa deben quedarse en la mesa.')
  }

  const single = 'tile' in move ? tiles[0] : undefined
  const ownBinding = single && rules.jokers.get(single.id)
  if (single && ownBinding && !draft.freedJokers.has(single.id) && targetGroup?.id !== ownBinding.groupId) {
    return failure('Sustituye el comodín por la ficha que indica antes de moverlo.', ownBinding.groupId)
  }

  const anchoredTiles = targetGroup?.tiles ?? (move.to === 'rack' ? draft.rack : [])
  if (move.anchor && !anchoredTiles.some(item => item.id === move.anchor)) {
    return failure('La posición de destino ya no existe.')
  }

  const rack = draft.rack.filter(item => !movedIds.has(item.id))
  const table = draft.table.map(group => group === sourceGroup || group === targetGroup
    ? { ...group, tiles: group.tiles.filter(item => !movedIds.has(item.id)) } : group)
  const target = targetGroup && table.find(group => group.id === targetGroup.id)
  let nextGroupId = draft.nextGroupId
  const freedJokers = new Set(draft.freedJokers)

  if (move.to === 'new') {
    table.push({ id: nextGroupId++, tiles, jokers: {} })
  } else {
    const destination = target?.tiles ?? rack
    const anchorIndex = destination.findIndex(item => item.id === move.anchor)
    const anchor = destination[anchorIndex]
    const binding = anchor && rules.jokers.get(anchor.id)
    if (target && single && binding && !freedJokers.has(anchor.id)
      && single.color === binding.face.color && single.value === binding.face.value) {
      destination.splice(anchorIndex, 1, single)
      freedJokers.add(anchor.id)
      table.push({ id: nextGroupId++, tiles: [anchor], jokers: {} })
    } else {
      const insertAt = anchorIndex === -1 ? destination.length : anchorIndex + (move.side === 'before' ? 0 : 1)
      destination.splice(insertAt, 0, ...tiles)
    }
  }

  if (target && targetGroup) {
    const wasComplete = analyzeMeld(targetGroup.tiles, lockedFaces(rules, draft.freedJokers))
    const locked = lockedFaces(rules, freedJokers)
    const fits = wasComplete ? analyzeMeld(target.tiles, locked) : couldCompleteMeld(target.tiles, locked)
    if (!fits) {
      const label = single ? 'Esa ficha no encaja' : 'Esas fichas no encajan'
      return failure(`${label} en el grupo ${draft.table.indexOf(targetGroup) + 1}.`, target.id)
    }
  }

  return { ok: true, data: { table: table.filter(group => group.tiles.length), rack, freedJokers, nextGroupId } }
}
