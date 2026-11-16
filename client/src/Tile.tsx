import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Sparkles } from 'lucide-react'
import type { Face, Move, Tile as TileData } from '../../server/protocol'

const colorNames = { red: 'rojo', blue: 'azul', black: 'negro', orange: 'naranja' }

export function faceName(face: Face): string {
  return `${face.value} ${colorNames[face.color]}`
}

export function tileName(tile: TileData, face?: Face): string {
  if (tile.color !== 'joker') return faceName(tile)
  return face ? `Comodín · ${faceName(face)}` : 'Comodín'
}

export function TileVisual({ tile, face }: { tile: TileData; face?: Face }) {
  return (
    <span className={`tile-face tile-${tile.color}`} aria-hidden="true">
      <span className="tile-value">{tile.color === 'joker' ? <Sparkles size="1em" /> : tile.value}</span>
      {face ? <span className={`tile-binding tile-${face.color}`}>{face.value}</span> : <span className="tile-dot" />}
    </span>
  )
}

export type DropTarget = Omit<Move, 'tile'>

export function Tile({
  tile, face, zone, selected, editable, onClick,
}: {
  tile: TileData
  face?: Face
  zone: Move['to']
  selected: boolean
  editable: boolean
  onClick: () => void
}) {
  const { setNodeRef, listeners, isDragging, attributes } = useDraggable({ id: tile.id, disabled: !editable })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `before-${tile.id}`,
    data: { to: zone, anchor: tile.id } satisfies DropTarget,
    disabled: !editable,
  })
  const label = tileName(tile, face)
  if (!editable) return <span className="tile-static" role="img" aria-label={label} title={label}><TileVisual tile={tile} face={face} /></span>
  return (
    <button
      ref={node => { setNodeRef(node); setDropRef(node) }}
      type="button"
      className={`tile-button ${selected ? 'tile-selected' : ''} ${isDragging ? 'tile-dragging' : ''} ${isOver && !isDragging ? 'tile-over' : ''}`}
      aria-label={label}
      aria-describedby={attributes['aria-describedby']}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      {...listeners}
    >
      <TileVisual tile={tile} face={face} />
    </button>
  )
}
