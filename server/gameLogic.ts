import { randomInt } from 'node:crypto'
import { applyMove, lockedFaces, startDraft, turnRules } from './draft'
import { analyzeMeld } from './melds'
import { COLORS, DEAL_DURATION_MS, STARTING_RACK_SIZE, failure, type GameEnd, type Meld, type Move, type Result, type Tile, type TurnAction } from './protocol'

export { analyzeMeld } from './melds'
const TURN_NOTICE_MS = 7_000
type GamePlayer = { id: string; name: string; rack: Tile[]; opened: boolean }
export type Game = {
  players: GamePlayer[]
  pool: Tile[]
  table: Meld[]
  turn: number
  dealEndsAt: number
  current: number
  emptyPasses: number
  end: GameEnd | null
  lastAction: { action: TurnAction; expiresAt: number } | null
}

export function createDeck(): Tile[] {
  const deck: Tile[] = []
  for (const color of COLORS) {
    for (let value = 1; value <= 13; value++) {
      for (let copy = 1; copy <= 2; copy++) deck.push({ id: `${color}-${value}-${copy}`, color, value })
    }
  }
  deck.push({ id: 'joker-1', color: 'joker', value: 0 }, { id: 'joker-2', color: 'joker', value: 0 })
  return deck
}

export function createGame(seats: Pick<GamePlayer, 'id' | 'name'>[]): Game {
  const pool = createDeck()
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const players = seats.map(({ id, name }) => ({ id, name, rack: pool.splice(0, STARTING_RACK_SIZE), opened: false }))
  return { players, pool, table: [], turn: 1, dealEndsAt: Date.now() + DEAL_DURATION_MS, current: randomInt(players.length), emptyPasses: 0, end: null, lastAction: null }
}

function changedGroups(before: Meld[], after: Meld[]) {
  const previousGroups = new Map(before.map(group => [group.id, group]))
  const groupIds: number[] = []
  const tileIds: string[] = []
  for (const group of after) {
    const previous = previousGroups.get(group.id)
    const newIds = new Set(group.tiles.map(tile => tile.id))
    const oldOrder = previous?.tiles.filter(tile => newIds.has(tile.id)).map(tile => tile.id) ?? []
    const oldPositions = new Map(oldOrder.map((id, index) => [id, index]))
    let sharedPosition = 0
    const changedTiles = group.tiles.filter(({ id }) => {
      const oldPosition = oldPositions.get(id)
      if (oldPosition === undefined) return true
      const reordered = oldPosition !== sharedPosition++
      const oldFace = previous?.jokers[id]
      const face = group.jokers[id]
      return reordered || oldFace?.value !== face?.value || oldFace?.color !== face?.color
    })
    if (changedTiles.length || (previous && oldOrder.length !== previous.tiles.length)) groupIds.push(group.id)
    tileIds.push(...changedTiles.map(tile => tile.id))
  }
  return { groupIds, tileIds }
}

function turnNotice(action: TurnAction): NonNullable<Game['lastAction']> {
  return { action, expiresAt: Date.now() + TURN_NOTICE_MS }
}

export function confirmTurn(game: Game, moves: Move[]): Result<Game> {
  const player = game.players[game.current]
  const rules = turnRules(game.table, player.opened)
  let draft = startDraft(game.table, player.rack)
  for (const move of moves) {
    const result = applyMove(draft, rules, move)
    if (!result.ok) return result
    draft = result.data
  }

  const locked = lockedFaces(rules, draft.freedJokers)
  let openingPoints = 0
  const table: Meld[] = []
  for (const [index, group] of draft.table.entries()) {
    const label = `Grupo ${index + 1}`
    if (group.tiles.length < 3) return failure(`${label}: debe tener al menos 3 fichas.`, group.id)
    const analysis = analyzeMeld(group.tiles, locked)
    if (!analysis) {
      if (analyzeMeld(group.tiles)) return failure(`${label}: un comodín cambia de valor o color sin sustituirlo.`, group.id)
      return failure(`${label}: forma un trío, un cuarteto o una escalera del mismo color en orden ascendente.`, group.id)
    }
    for (const tile of group.tiles) {
      const original = rules.jokers.get(tile.id)
      if (original?.groupId === group.id && draft.freedJokers.has(tile.id)) {
        return failure(`${label}: el comodín recuperado debe jugarse en otro grupo.`, group.id)
      }
    }
    if (!player.opened && group.tiles.every(tile => !rules.tableIds.has(tile.id))) openingPoints += analysis.points
    table.push({ ...group, jokers: analysis.jokers })
  }
  if (draft.rack.length === player.rack.length) return failure('Baja al menos una ficha de tu atril para confirmar.')
  if (!player.opened && openingPoints < 30) {
    return failure(`La apertura suma ${openingPoints} puntos. Necesitas al menos 30 con fichas de tu atril.`)
  }

  const players = game.players.map(item => item === player ? { ...item, rack: draft.rack, opened: true } : item)
  const lastAction = turnNotice({
    kind: 'play', playerId: player.id, tilesPlayed: player.rack.length - draft.rack.length,
    ...changedGroups(game.table, table),
  })
  const next = { ...game, players, table, emptyPasses: 0, lastAction }
  return { ok: true, data: draft.rack.length ? advance(next) : finish(next, 'empty-rack', player.id) }
}

export function drawOrPass(game: Game): Game {
  const player = game.players[game.current]
  if (game.pool.length) {
    const tile = game.pool.at(-1)!
    const players = game.players.map(item => item === player ? { ...item, rack: [...item.rack, tile] } : item)
    return advance({
      ...game, pool: game.pool.slice(0, -1), players, emptyPasses: 0,
      lastAction: turnNotice({ kind: 'draw', playerId: player.id }),
    })
  }

  const next = {
    ...game, emptyPasses: game.emptyPasses + 1, lastAction: turnNotice({ kind: 'pass', playerId: player.id }),
  }
  return next.emptyPasses === game.players.length ? finish(next, 'blocked') : advance(next)
}

function advance(game: Game): Game {
  return { ...game, turn: game.turn + 1, current: (game.current + 1) % game.players.length }
}

function finish(game: Game, reason: GameEnd['reason'], playerId?: string): Game {
  const points = Object.fromEntries(game.players.map(player => [
    player.id, player.rack.reduce((total, tile) => total + (tile.color === 'joker' ? 30 : tile.value), 0),
  ]))
  const lowest = Math.min(...Object.values(points))
  const winners = playerId ? [playerId] : game.players.filter(player => points[player.id] === lowest).map(player => player.id)
  return { ...game, turn: game.turn + 1, end: { reason, winners, points } }
}
