import { COLORS, type Face, type Tile } from './protocol'

export type MeldKind = 'set' | 'run'
type MeldAnalysis = { kind: MeldKind; points: number; jokers: Record<string, Face> }

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

export function couldCompleteMeld(tiles: Tile[], locked: ReadonlyMap<string, Face>): boolean {
  if (tiles.length > 13) return false
  const known = tiles.flatMap((tile, position) => {
    const face = tile.color === 'joker' ? locked.get(tile.id) : tile
    return face ? [{ ...face, position }] : []
  })
  const first = known[0]
  if (!first) return true

  if (tiles.length <= 4 && known.every(face => face.value === first.value)
    && new Set(known.map(face => face.color)).size === known.length) return true

  const last = known[known.length - 1]
  return first.value - first.position >= 1
    && last.value + (tiles.length - 1 - last.position) <= 13
    && known.every((face, index) => {
      const previous = known[index - 1]
      return face.color === first.color && (!previous || face.value - previous.value >= face.position - previous.position)
    })
}
