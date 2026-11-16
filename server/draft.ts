import { failure, type Face, type Meld, type Move, type Result, type Tile } from './protocol'

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

export function moveTile(draft: Draft, rules: TurnRules, move: Move): Result<Draft> {
  const sourceGroup = draft.table.find(group => group.tiles.some(tile => tile.id === move.tile))
  const tile = (sourceGroup?.tiles ?? draft.rack).find(candidate => candidate.id === move.tile)
  if (!tile) return failure('Esa ficha no está disponible.')
  if (move.tile === move.anchor) return { ok: true, data: draft }

  const targetGroup = draft.table.find(group => group.id === move.to)
  if (typeof move.to === 'number' && !targetGroup) return failure('Ese grupo ya no existe.')
  if (!rules.opened && [sourceGroup, targetGroup].some(group => group?.tiles.some(item => rules.tableIds.has(item.id)))) {
    return failure('Completa tu apertura de 30 puntos antes de tocar los grupos de la mesa.')
  }
  if (move.to === 'rack' && rules.tableIds.has(tile.id)) {
    return failure('Las fichas que ya estaban en la mesa deben quedarse en la mesa.')
  }

  const ownBinding = rules.jokers.get(tile.id)
  if (ownBinding && !draft.freedJokers.has(tile.id) && targetGroup?.id !== ownBinding.groupId) {
    return failure('Sustituye el comodín por la ficha que indica antes de moverlo.', ownBinding.groupId)
  }

  const anchoredTiles = targetGroup?.tiles ?? (move.to === 'rack' ? draft.rack : [])
  if (move.anchor && !anchoredTiles.some(item => item.id === move.anchor)) {
    return failure('La posición de destino ya no existe.')
  }

  const rack = draft.rack.filter(item => item.id !== tile.id)
  const table = draft.table.map(group => ({ ...group, tiles: group.tiles.filter(item => item.id !== tile.id) }))
  const target = table.find(group => group.id === move.to)
  let nextGroupId = draft.nextGroupId
  const freedJokers = new Set(draft.freedJokers)

  if (move.to === 'new') {
    table.push({ id: nextGroupId++, tiles: [tile], jokers: {} })
  } else {
    const destination = target?.tiles ?? rack
    const anchorIndex = destination.findIndex(item => item.id === move.anchor)
    const anchor = destination[anchorIndex]
    const binding = anchor && rules.jokers.get(anchor.id)
    if (target && binding && !freedJokers.has(anchor.id)
      && tile.color === binding.face.color && tile.value === binding.face.value) {
      destination.splice(anchorIndex, 1, tile)
      freedJokers.add(anchor.id)
      table.push({ id: nextGroupId++, tiles: [anchor], jokers: {} })
    } else {
      const insertAt = anchorIndex === -1 ? destination.length : anchorIndex + (move.side === 'before' ? 0 : 1)
      destination.splice(insertAt, 0, tile)
    }
  }
  return { ok: true, data: { table: table.filter(group => group.tiles.length), rack, freedJokers, nextGroupId } }
}
