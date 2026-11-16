import { COLORS, type Color, type Tile } from '../../server/protocol'
import type { MeldKind } from '../../server/melds'

export function findRackMeld(rack: Tile[], tileId: string, preferred: MeldKind): Tile[] | null {
  const selected = rack.find(tile => tile.id === tileId)
  if (!selected) return null

  const numbered = new Map<Color, Map<number, Tile>>(COLORS.map(color => [color, new Map()]))
  const jokers = rack.filter(tile => tile.color === 'joker')
  if (selected.color === 'joker') jokers.sort((a, b) => Number(b.id === tileId) - Number(a.id === tileId))
  for (const tile of rack) {
    if (tile.color === 'joker') continue
    const color = numbered.get(tile.color)!
    if (tile.id === tileId || !color.has(tile.value)) color.set(tile.value, tile)
  }

  const candidates: { tiles: Tile[]; kind: MeldKind; jokers: number; points: number }[] = []
  function consider(tiles: Tile[], kind: MeldKind, points: number) {
    if (tiles.length >= 3 && tiles.some(tile => tile.id === tileId)) {
      candidates.push({ tiles: tiles.slice(), kind, jokers: tiles.filter(tile => tile.color === 'joker').length, points })
    }
  }

  const setValues = selected.color === 'joker' ? Array.from({ length: 13 }, (_, i) => i + 1) : [selected.value]
  for (const value of setValues) {
    const matches = COLORS.flatMap(color => numbered.get(color)?.get(value) ?? [])
    if (selected.color === 'joker') matches.splice(3)
    const needed = Math.max(3 - matches.length, Number(selected.color === 'joker'))
    const tiles = [...matches, ...jokers.slice(0, needed)]
    consider(tiles, 'set', value * tiles.length)
  }

  const runColors = selected.color === 'joker' ? COLORS : [selected.color]
  for (const color of runColors) {
    const values = numbered.get(color)!
    for (let start = 1; start <= 11; start++) {
      const tiles: Tile[] = []
      let usedJokers = 0
      for (let value = start; value <= 13; value++) {
        const tile = values.get(value) ?? jokers[usedJokers++]
        if (!tile) break
        tiles.push(tile)
        consider(tiles, 'run', tiles.length * (start + value) / 2)
      }
    }
  }

  candidates.sort((a, b) => Number(b.kind === preferred) - Number(a.kind === preferred)
    || a.jokers - b.jokers || b.tiles.length - a.tiles.length || b.points - a.points)
  return candidates[0]?.tiles ?? null
}
