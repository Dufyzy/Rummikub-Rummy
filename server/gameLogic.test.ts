import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeMeld, confirmTurn, createDeck, createGame, drawOrPass, type Game } from './gameLogic'
import type { Color, Meld, Move, Tile } from './protocol'

function tile(color: Color, value: number, copy = 1): Tile {
  return { id: `${color}-${value}-${copy}`, color, value }
}

const joker: Tile = { id: 'joker-1', color: 'joker', value: 0 }
const spare = tile('orange', 2)
const blueRun = [tile('blue', 9), joker, tile('blue', 11)]
const boundRun: Meld = { id: 1, tiles: blueRun, jokers: { [joker.id]: { color: 'blue', value: 10 } } }

function fixture(rack: Tile[], table: Meld[] = [], opened = false): Game {
  return {
    players: [{ id: 'first', name: 'Sol', rack, opened }, { id: 'next', name: 'Luz', rack: [spare], opened: false }],
    pool: [],
    table,
    turn: 1,
    dealEndsAt: 0,
    current: 0,
    emptyPasses: 0,
    end: null,
  }
}

function place(tiles: Tile[], group = 1): Move[] {
  return tiles.map((item, i) => ({ tile: item.id, to: i === 0 ? 'new' : group }))
}

test('deals 14 from a deck of 106 distinct tiles to each player', () => {
  const deck = createDeck()
  assert.equal(deck.length, 106)
  assert.equal(new Set(deck.map(item => item.id)).size, 106)
  assert.equal(deck.filter(item => item.color === 'joker').length, 2)
  for (const count of [2, 3, 4]) {
    const game = createGame(Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Jugador ${i + 1}` })))
    assert.deepEqual(game.players.map(player => player.rack.length), Array(count).fill(14))
    assert.equal(game.pool.length, 106 - 14 * count)
    assert.equal(new Set([...game.pool, ...game.players.flatMap(player => player.rack)].map(item => item.id)).size, 106)
  }
})

test('sets accept three or four different colors with the same number', () => {
  const set = [tile('red', 7), tile('blue', 7), tile('black', 7)]
  assert.equal(analyzeMeld(set)?.kind, 'set')
  assert.equal(analyzeMeld([...set, tile('orange', 7)])?.points, 28)
  assert.equal(analyzeMeld([...set, tile('red', 7, 2)]), null)
  assert.equal(analyzeMeld([set[0], set[1], tile('black', 8)]), null)
  assert.equal(analyzeMeld(set.slice(0, 2)), null)
})

test('runs are ascending, consecutive and single-color, and cannot wrap at 13', () => {
  const run = (...values: number[]) => values.map(value => tile('red', value))
  assert.equal(analyzeMeld(run(1, 2, 3, 4, 5))?.kind, 'run')
  assert.equal(analyzeMeld(run(11, 12, 13))?.points, 36)
  assert.equal(analyzeMeld(run(12, 13, 1)), null)
  assert.equal(analyzeMeld(run(3, 4, 6)), null)
  assert.equal(analyzeMeld(run(3, 5, 4)), null)
  assert.equal(analyzeMeld([...run(1, 2), tile('blue', 3)]), null)
})

test('opening counts the represented joker value and rejects fewer than 30 points', () => {
  assert.deepEqual(analyzeMeld(blueRun), { kind: 'run', points: 30, jokers: boundRun.jokers })
  const game = fixture([...blueRun, spare])
  const accepted = confirmTurn(game, place(blueRun))
  assert.ok(accepted.ok)
  assert.equal(accepted.data.players[0].opened, true)
  assert.equal(accepted.data.current, 1)
  const low = [tile('black', 8), joker, tile('black', 10)]
  assert.deepEqual(analyzeMeld([tile('red', 10), tile('black', 10), joker])?.jokers, boundRun.jokers)
  assert.match(errorOf(confirmTurn(fixture(low), place(low))), /27 puntos/)
  assert.equal(game.table.length, 0)
  assert.equal(game.players[0].rack.length, 4)
})

test('opening can combine multiple groups, and cannot touch the existing table', () => {
  const red = [tile('red', 4), tile('red', 5), tile('red', 6)]
  const orange = [tile('orange', 4), tile('orange', 5), tile('orange', 6)]
  const game = fixture([...red, ...orange], [boundRun])
  assert.match(errorOf(confirmTurn(game, [{ tile: red[0].id, to: 1 }])), /apertura/)
  assert.match(errorOf(confirmTurn(game, [{ tile: blueRun[0].id, to: 'new' }])), /apertura/)
  const result = confirmTurn(game, [...place(red, 2), ...place(orange, 3)])
  assert.ok(result.ok)
  assert.deepEqual(result.data.table[0], boundRun)
  assert.deepEqual(result.data.end?.winners, ['first'])
})

test('validation rejects missing rack contribution, unknown tiles and incomplete groups', () => {
  const game = fixture([spare], [boundRun], true)
  assert.match(errorOf(confirmTurn(game, [])), /al menos una ficha/)
  assert.match(errorOf(confirmTurn(game, [{ tile: 'unknown', to: 'new' }])), /no está disponible/)
  assert.match(errorOf(confirmTurn(game, [{ tile: blueRun[0].id, to: 'rack' }])), /quedarse en la mesa/)
  const result = confirmTurn(game, [{ tile: spare.id, to: 'new' }])
  assert.ok(!result.ok)
  assert.equal(result.error.groupId, 2)
  assert.match(result.error.message, /Grupo 2/)
})

test('a committed joker requires an exact replacement and must finish in another group', () => {
  const blue10 = tile('blue', 10)
  const red10 = tile('red', 10)
  const red11 = tile('red', 11)
  const game = fixture([blue10, red10, red11], [boundRun], true)
  const swap = { tile: blue10.id, to: 1, anchor: joker.id }
  assert.match(errorOf(confirmTurn(game, [{ tile: joker.id, to: 'new' }])), /Sustituye/)
  assert.match(errorOf(confirmTurn(game, [{ ...swap, tile: red10.id }, { tile: joker.id, to: 'new' }])), /no encaja/)
  assert.match(errorOf(confirmTurn(game, [swap])), /Grupo 2/)
  const result = confirmTurn(game, [swap, { tile: red10.id, to: 2 }, { tile: red11.id, to: 2 }])
  assert.ok(result.ok)
  assert.deepEqual(result.data.table[0].tiles.map(item => item.id), [blueRun[0].id, blue10.id, blueRun[2].id])
  assert.deepEqual(result.data.table[1].jokers, { [joker.id]: { value: 9, color: 'red' } })
  assert.equal(result.data.end?.reason, 'empty-rack')
  const movedBack = confirmTurn(game, [
    swap, { tile: tile('blue', 11).id, to: 'new' }, { tile: joker.id, to: 1 },
  ])
  assert.match(errorOf(movedBack), /otro grupo/)
})

test('opened players can split and extend groups with a tile from their rack', () => {
  const run = [1, 2, 3, 4, 5].map(value => tile('black', value))
  const black3 = tile('black', 3, 2)
  const game = fixture([black3, spare], [{ id: 1, tiles: run, jokers: {} }], true)
  const result = confirmTurn(game, [
    { tile: black3.id, to: 'new' }, { tile: run[3].id, to: 2 }, { tile: run[4].id, to: 2 },
  ])
  assert.ok(result.ok)
  assert.deepEqual(result.data.table.map(group => group.tiles.map(item => item.value)), [[1, 2, 3], [3, 4, 5]])
  assert.deepEqual(result.data.players[0].rack, [spare])
})

test('a group rejects incompatible additions immediately without changing the draft', () => {
  const run = [3, 4, 5].map(value => tile('red', value))
  const red6 = tile('red', 6)
  const red7 = tile('red', 7)
  const blue6 = tile('blue', 6)
  const game = fixture([red6, red7, blue6], [{ id: 1, tiles: run, jokers: {} }], true)
  for (const item of [blue6, red7]) {
    const rejected = confirmTurn(game, [{ tile: item.id, to: 1 }])
    assert.ok(!rejected.ok)
    assert.deepEqual(rejected.error, { message: 'Esa ficha no encaja en el grupo 1.', groupId: 1 })
    assert.deepEqual(game.table[0].tiles, run)
  }
  assert.ok(confirmTurn(game, [{ tile: red6.id, to: 1 }, { tile: red7.id, to: 1 }]).ok)
})

test('an incomplete run can be assembled around a gap but rejects an incompatible partial placement', () => {
  const [four, five, six] = [4, 5, 6].map(value => tile('black', value))
  const game = fixture([four, five, six, spare], [], true)
  const partial: Move[] = [{ tile: four.id, to: 'new' }, { tile: six.id, to: 1 }]
  assert.match(errorOf(confirmTurn(game, [...partial, { tile: spare.id, to: 1 }])), /no encaja/)
  const accepted = confirmTurn(game, [...partial, { tile: five.id, to: 1, anchor: six.id, side: 'before' }])
  assert.ok(accepted.ok)
  assert.deepEqual(accepted.data.table[0].tiles, [four, five, six])
})

test('a rack group is placed atomically and its identities and order are validated', () => {
  const run = [10, 11, 12].map(value => tile('orange', value))
  const ids = run.map(item => item.id)
  const game = fixture([...run, spare])
  const accepted = confirmTurn(game, [{ tiles: ids, to: 'new' }])
  assert.ok(accepted.ok)
  assert.deepEqual(accepted.data.table[0].tiles, run)
  assert.deepEqual(accepted.data.players[0].rack, [spare])
  assert.match(errorOf(confirmTurn(game, [{ tiles: [ids[0], ids[0], ids[2]], to: 'new' }])), /no está disponible/)
  assert.match(errorOf(confirmTurn(game, [{ tiles: ids.slice().reverse(), to: 'new' }])), /grupo válido/)

  const onTable = [7, 8, 9].map(value => tile('orange', value))
  const opened = fixture(run, [{ id: 1, tiles: onTable, jokers: {} }], true)
  const merged = confirmTurn(opened, [{ tiles: ids, to: 1 }])
  assert.ok(merged.ok)
  assert.deepEqual(merged.data.table[0].tiles, [...onTable, ...run])
})

test('draw ends the turn; a full round of empty-pool passes ranks rack points and preserves ties', () => {
  const game = fixture([joker])
  const drawn = drawOrPass({ ...game, pool: [tile('red', 1)] })
  assert.deepEqual(drawn.players[0].rack, [joker, tile('red', 1)])
  assert.equal(drawn.current, 1)
  assert.equal(drawn.emptyPasses, 0)
  const passed = drawOrPass(drawn)
  assert.equal(passed.end, null)
  assert.deepEqual(drawOrPass(passed).end, { reason: 'blocked', winners: ['next'], points: { first: 31, next: 2 } })
  assert.deepEqual(drawOrPass(drawOrPass(fixture([tile('red', 2)]))).end?.winners, ['first', 'next'])
})

function errorOf(result: ReturnType<typeof confirmTurn>): string {
  assert.ok(!result.ok)
  return result.error.message
}
