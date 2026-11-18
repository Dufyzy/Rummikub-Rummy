import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMove, startDraft, turnRules } from './draft'
import { analyzeMeld, confirmTurn, createDeck, createGame, drawOrPass, type Game } from './gameLogic'
import type { Color, Meld, Move, Tile } from './protocol'

function tile(color: Color, value: number, copy = 1): Tile {
  return { id: `${color}-${value}-${copy}`, color, value }
}

const joker: Tile = { id: 'joker-1', color: 'joker', value: 0 }
const spare = tile('purple', 2)
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
    lastAction: null,
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
  for (const color of ['pink', 'purple', 'blue', 'black']) {
    assert.equal(deck.filter(item => item.color === color).length, 26)
  }
  for (const count of [2, 3, 4]) {
    const game = createGame(Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Jugador ${i + 1}` })))
    assert.deepEqual(game.players.map(player => player.rack.length), Array(count).fill(14))
    assert.equal(game.pool.length, 106 - 14 * count)
    assert.equal(new Set([...game.pool, ...game.players.flatMap(player => player.rack)].map(item => item.id)).size, 106)
  }
})

test('sets accept three or four different colors with the same number', () => {
  const set = [tile('pink', 7), tile('blue', 7), tile('black', 7)]
  assert.equal(analyzeMeld(set)?.kind, 'set')
  assert.equal(analyzeMeld([...set, tile('purple', 7)])?.points, 28)
  assert.equal(analyzeMeld([...set, tile('pink', 7, 2)]), null)
  assert.equal(analyzeMeld([set[0], set[1], tile('black', 8)]), null)
  assert.equal(analyzeMeld(set.slice(0, 2)), null)
})

test('runs are ascending, consecutive and single-color, and cannot wrap at 13', () => {
  const run = (...values: number[]) => values.map(value => tile('pink', value))
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
  assert.deepEqual(analyzeMeld([tile('pink', 10), tile('black', 10), joker])?.jokers, boundRun.jokers)
  assert.match(errorOf(confirmTurn(fixture(low), place(low))), /27 puntos/)
  assert.equal(game.table.length, 0)
  assert.equal(game.players[0].rack.length, 4)
})

test('opening can combine multiple groups, and cannot touch the existing table', () => {
  const pink = [tile('pink', 4), tile('pink', 5), tile('pink', 6)]
  const purple = [tile('purple', 4), tile('purple', 5), tile('purple', 6)]
  const game = fixture([...pink, ...purple], [boundRun])
  assert.match(errorOf(confirmTurn(game, [{ tile: pink[0].id, to: 1 }])), /apertura/)
  assert.match(errorOf(confirmTurn(game, [{ tile: blueRun[0].id, to: 'new' }])), /apertura/)
  const result = confirmTurn(game, [...place(pink, 2), ...place(purple, 3)])
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

test('a direct swap in the middle of a run needs the missing tile', () => {
  const blue10 = tile('blue', 10)
  const pink10 = tile('pink', 10)
  const pink11 = tile('pink', 11)
  const game = fixture([blue10, pink10, pink11], [boundRun], true)
  const swap = { tile: blue10.id, to: 1, anchor: joker.id }
  assert.match(errorOf(confirmTurn(game, [{ ...swap, tile: pink10.id }, { tile: joker.id, to: 'new' }])), /no encaja/)
  assert.match(errorOf(confirmTurn(game, [swap])), /Grupo 2/)
  const result = confirmTurn(game, [swap, { tile: pink10.id, to: 2 }, { tile: pink11.id, to: 2 }])
  assert.ok(result.ok)
  assert.deepEqual(result.data.table[0].tiles.map(item => item.id), [blueRun[0].id, blue10.id, blueRun[2].id])
  assert.deepEqual(result.data.table[1].jokers, { [joker.id]: { value: 9, color: 'pink' } })
  assert.equal(result.data.end?.reason, 'empty-rack')
  const movedBack = confirmTurn(game, [
    swap, { tile: tile('blue', 11).id, to: 'new' }, { tile: joker.id, to: 1 },
  ])
  assert.match(errorOf(movedBack), /otro grupo/)
})

test('a joker can leave its original run incomplete until turn confirmation', () => {
  const blue10 = tile('blue', 10)
  const [pink10, pink11] = [tile('pink', 10), tile('pink', 11)]
  const game = fixture([blue10, pink10, pink11], [boundRun], true)
  const remove: Move = { tile: joker.id, to: 'new' }
  const draft = applyMove(startDraft(game.table, game.players[0].rack), turnRules(game.table, true), remove)
  assert.ok(draft.ok)
  assert.deepEqual(draft.data.table.map(group => group.tiles), [[blueRun[0], blueRun[2]], [joker]])

  const reuse: Move[] = [remove, { tile: pink10.id, to: 2 }, { tile: pink11.id, to: 2 }]
  assert.match(errorOf(confirmTurn(game, reuse)), /Grupo 1: debe tener al menos 3 fichas/)
  const result = confirmTurn(game, [...reuse, { tile: blue10.id, to: 1, anchor: blueRun[2].id, side: 'before' }])
  assert.ok(result.ok)
  assert.deepEqual(result.data.table[0].tiles, [blueRun[0], blue10, blueRun[2]])
  assert.deepEqual(result.data.table[1].jokers, { [joker.id]: { color: 'pink', value: 9 } })
})

test('a set joker can be recovered using a different valid color', () => {
  const purple13 = tile('purple', 13)
  const blue13 = tile('blue', 13)
  const black13 = tile('black', 13)
  const duplicateBlue13 = tile('blue', 13, 2)
  const [pink10, pink11] = [tile('pink', 10), tile('pink', 11)]
  const set: Meld = { id: 1, tiles: [joker, purple13, blue13], jokers: { [joker.id]: { color: 'pink', value: 13 } } }
  const game = fixture([black13, duplicateBlue13, pink10, pink11], [set], true)

  assert.match(errorOf(confirmTurn(game, [{ tile: duplicateBlue13.id, to: 1, anchor: joker.id }])), /no encaja/)

  const recoveries: Move[][] = [
    [{ tile: black13.id, to: 1 }, { tile: joker.id, to: 'new' }],
    [{ tile: black13.id, to: 1, anchor: joker.id }],
  ]
  for (const moves of recoveries) {
    const result = confirmTurn(game, [...moves, { tile: pink10.id, to: 2 }, { tile: pink11.id, to: 2 }])
    assert.ok(result.ok)
    assert.deepEqual(new Set(result.data.table[0].tiles), new Set([purple13, blue13, black13]))
    assert.deepEqual(result.data.table[0].jokers, {})
    assert.deepEqual(result.data.table[1].jokers, { [joker.id]: { color: 'pink', value: 9 } })
    assert.deepEqual(result.data.players[0].rack, [duplicateBlue13])
  }
})

test('the joker can leave a four-tile set without a replacement', () => {
  const thirteens = [tile('purple', 13), tile('blue', 13), tile('black', 13)]
  const set: Meld = { id: 1, tiles: [joker, ...thirteens], jokers: { [joker.id]: { color: 'pink', value: 13 } } }
  const [pink10, pink11] = [tile('pink', 10), tile('pink', 11)]
  const game = fixture([pink10, pink11], [set], true)
  const remove: Move = { tile: joker.id, to: 'new' }
  assert.match(errorOf(confirmTurn(game, [remove])), /Grupo 2: debe tener al menos 3 fichas/)
  const result = confirmTurn(game, [remove, { tile: pink10.id, to: 2 }, { tile: pink11.id, to: 2 }])
  assert.ok(result.ok)
  assert.deepEqual(result.data.table[0], { id: 1, tiles: thirteens, jokers: {} })
  assert.deepEqual(result.data.table[1].jokers, { [joker.id]: { color: 'pink', value: 9 } })
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
  assert.deepEqual(result.data.lastAction?.action, {
    kind: 'play', playerId: 'first', tilesPlayed: 1,
    groupIds: [1, 2], tileIds: [black3.id, run[3].id, run[4].id],
  })
})

test('a group rejects incompatible additions immediately without changing the draft', () => {
  const run = [3, 4, 5].map(value => tile('pink', value))
  const pink6 = tile('pink', 6)
  const pink7 = tile('pink', 7)
  const blue6 = tile('blue', 6)
  const game = fixture([pink6, pink7, blue6], [{ id: 1, tiles: run, jokers: {} }], true)
  for (const item of [blue6, pink7]) {
    const rejected = confirmTurn(game, [{ tile: item.id, to: 1 }])
    assert.ok(!rejected.ok)
    assert.deepEqual(rejected.error, { message: 'Esa ficha no encaja en el grupo 1.', groupId: 1 })
    assert.deepEqual(game.table[0].tiles, run)
  }
  assert.ok(confirmTurn(game, [{ tile: pink6.id, to: 1 }, { tile: pink7.id, to: 1 }]).ok)
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
  const run = [10, 11, 12].map(value => tile('purple', value))
  const ids = run.map(item => item.id)
  const game = fixture([...run, spare])
  const accepted = confirmTurn(game, [{ tiles: ids, to: 'new' }])
  assert.ok(accepted.ok)
  assert.deepEqual(accepted.data.table[0].tiles, run)
  assert.deepEqual(accepted.data.players[0].rack, [spare])
  assert.match(errorOf(confirmTurn(game, [{ tiles: [ids[0], ids[0], ids[2]], to: 'new' }])), /no está disponible/)
  assert.match(errorOf(confirmTurn(game, [{ tiles: ids.slice().reverse(), to: 'new' }])), /grupo válido/)

  const onTable = [7, 8, 9].map(value => tile('purple', value))
  const opened = fixture(run, [{ id: 1, tiles: onTable, jokers: {} }], true)
  const merged = confirmTurn(opened, [{ tiles: ids, to: 1 }])
  assert.ok(merged.ok)
  assert.deepEqual(merged.data.table[0].tiles, [...onTable, ...run])
  const prepended = confirmTurn(fixture(onTable, [{ id: 1, tiles: run, jokers: {} }], true), [
    { tiles: onTable.map(item => item.id), to: 1, anchor: run[0].id, side: 'before' },
  ])
  assert.ok(prepended.ok)
  assert.deepEqual(prepended.data.lastAction?.action, {
    kind: 'play', playerId: 'first', tilesPlayed: 3,
    groupIds: [1], tileIds: onTable.map(item => item.id),
  })
})

test('draw ends the turn; a full round of empty-pool passes ranks rack points and preserves ties', () => {
  const game = fixture([joker])
  const drawn = drawOrPass({ ...game, pool: [tile('pink', 1)] })
  assert.deepEqual(drawn.players[0].rack, [joker, tile('pink', 1)])
  assert.equal(drawn.current, 1)
  assert.equal(drawn.emptyPasses, 0)
  assert.deepEqual(drawn.lastAction?.action, { kind: 'draw', playerId: 'first' })
  const passed = drawOrPass(drawn)
  assert.equal(passed.end, null)
  assert.deepEqual(passed.lastAction?.action, { kind: 'pass', playerId: 'next' })
  assert.deepEqual(drawOrPass(passed).end, { reason: 'blocked', winners: ['next'], points: { first: 31, next: 2 } })
  assert.deepEqual(drawOrPass(drawOrPass(fixture([tile('pink', 2)]))).end?.winners, ['first', 'next'])
})

function errorOf(result: ReturnType<typeof confirmTurn>): string {
  assert.ok(!result.ok)
  return result.error.message
}
