import { randomInt } from 'node:crypto'
import { moveTile, startDraft, turnRules } from './draft'
import { COLORS, failure, type Face, type GameEnd, type Meld, type Move, type Result, type Tile } from './protocol'

type MeldAnalysis = { kind: 'set' | 'run'; points: number; jokers: Record<string, Face> }
type GamePlayer = { id: string; name: string; rack: Tile[]; opened: boolean }
export type Game = {
  players: GamePlayer[]
  pool: Tile[]
  table: Meld[]
  turn: number
  current: number
  emptyPasses: number
  end: GameEnd | null
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
  const players = seats.map(({ id, name }) => ({ id, name, rack: pool.splice(0, 14), opened: false }))
  return { players, pool, table: [], turn: 1, current: randomInt(players.length), emptyPasses: 0, end: null }
}

export function analyzeMeld(tiles: Tile[], locked: ReadonlyMap<string, Face> = new Map()): MeldAnalysis | null {
  if (tiles.length < 3 || tiles.length > 13) return null
  const numbered = tiles.filter(tile => tile.color !== 'joker')
  const first = numbered[0]
  if (!first) return null
  const usedColors = new Set(numbered.map(tile => tile.color))
  const jokers = tiles.filter(tile => tile.color === 'joker')
  const candidates: MeldAnalysis[] = []

  if (tiles.length <= 4 && usedColors.size === numbered.length && numbered.every(tile => tile.value === first.value)) {
    const available = COLORS.filter(color => !usedColors.has(color))
    const assignments: Record<string, Face> = {}
    for (const joker of jokers) {
      const face = locked.get(joker.id)
      if (face) assignments[joker.id] = face
    }
    const reserved = Object.values(assignments).map(face => face.color)
    const unreserved = available.filter(color => !reserved.includes(color))
    if (new Set(reserved).size === reserved.length
      && Object.values(assignments).every(face => face.value === first.value && available.includes(face.color))) {
      for (const joker of jokers) {
        if (!assignments[joker.id]) assignments[joker.id] = { color: unreserved.shift()!, value: first.value }
      }
      candidates.push({ kind: 'set', points: first.value * tiles.length, jokers: assignments })
    }
  }

  const start = first.value - tiles.indexOf(first)
  if (start >= 1 && start + tiles.length - 1 <= 13
    && tiles.every((tile, i) => tile.color === 'joker' || (tile.color === first.color && tile.value === start + i))) {
    const color = first.color
    const assignments = Object.fromEntries(tiles.flatMap((tile, i) =>
      tile.color === 'joker' ? [[tile.id, { color, value: start + i }]] : []))
    candidates.push({ kind: 'run', points: tiles.length * (2 * start + tiles.length - 1) / 2, jokers: assignments })
  }

  const compatible = candidates.filter(candidate => jokers.every(joker => {
    const face = locked.get(joker.id)
    const assigned = candidate.jokers[joker.id]
    return !face || (face.value === assigned.value && face.color === assigned.color)
  }))
  return compatible.sort((a, b) => b.points - a.points)[0] ?? null
}

export function confirmTurn(game: Game, moves: Move[]): Result<Game> {
  const player = game.players[game.current]
  const rules = turnRules(game.table, player.opened)
  let draft = startDraft(game.table, player.rack)
  for (const move of moves) {
    const result = moveTile(draft, rules, move)
    if (!result.ok) return result
    draft = result.data
  }

  const locked = new Map([...rules.jokers].flatMap(([id, binding]) => draft.freedJokers.has(id) ? [] : [[id, binding.face]]))
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
  const next = { ...game, players, table, emptyPasses: 0 }
  return { ok: true, data: draft.rack.length ? advance(next) : finish(next, 'empty-rack', player.id) }
}

export function drawOrPass(game: Game): Game {
  const player = game.players[game.current]
  if (game.pool.length) {
    const tile = game.pool.at(-1)!
    const players = game.players.map(item => item === player ? { ...item, rack: [...item.rack, tile] } : item)
    return advance({ ...game, pool: game.pool.slice(0, -1), players, emptyPasses: 0 })
  }

  const next = { ...game, emptyPasses: game.emptyPasses + 1 }
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
