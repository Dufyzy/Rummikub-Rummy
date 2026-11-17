import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core'
import { useReducedMotion } from 'framer-motion'
import { ArrowDownUp, ArrowLeftToLine, Check, CircleAlert, DoorOpen, Layers3, LockKeyhole, Plus, RotateCcw, Trophy } from 'lucide-react'
import { COLORS } from '../../server/protocol'
import type { GameView, LiveReaction, Meld, Move, PlayerView, Problem, RoomView, Tile as TileData, TurnAction } from '../../server/protocol'
import { applyMove, startDraft, turnRules } from '../../server/draft'
import type { MeldKind } from '../../server/melds'
import { DealAnimation } from './DealAnimation'
import { findRackMeld } from './rackMeld'
import { Avatar, ErrorNotice } from './RoomScreens'
import { Tile, TileVisual, tileName, type DropTarget } from './Tile'
import { PlayerReaction } from './Reactions'
import { MessagePreview } from './MessagePreview'
import type { IncomingMessage } from './roomSocial'

type MatchProps = {
  room: RoomView & { game: GameView }
  reactions: Record<string, LiveReaction>
  incoming?: IncomingMessage
  ready: boolean
  pending: boolean
  onConfirm: (moves: Move[]) => Promise<Problem | null>
  onDraw: () => Promise<Problem | null>
  onLeave: () => void
  leaveError: Problem | null
}

type RecentPlay = Extract<TurnAction, { kind: 'play' }>
const GROUP_HOLD_MS = 460
const EMPTY_DRAG_GROUP = new Set<string>()

const targetsUnderPointer: CollisionDetection = args => {
  const collisions = pointerWithin(args)
  const tile = collisions.find(item => item.data?.droppableContainer.data.current?.anchor)
  const target = tile ?? collisions.find(item => item.id !== 'board-background') ?? collisions[0]
  return target ? [target] : []
}

function loadOrder(key: string): string[] {
  try {
    const order: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]')
    return Array.isArray(order) ? order.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

function orderRack(rack: TileData[], order: string[]) {
  const positions = new Map(order.map((id, index) => [id, index]))
  return rack.slice().sort((a, b) =>
    (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
}

function Group({
  group, index, canDrop, editable, selected, invalid, recent, onTarget,
}: {
  group: Meld
  index: number
  canDrop: boolean
  editable: boolean
  selected: string | null
  invalid: boolean
  recent?: RecentPlay
  onTarget: (target: DropTarget) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-${group.id}`, data: { to: group.id } satisfies DropTarget, disabled: !canDrop,
  })
  return (
    <section ref={setNodeRef} className={`meld ${recent ? 'meld-recent' : ''} ${invalid ? 'meld-invalid' : ''} ${isOver ? 'drop-hover' : ''}`} aria-label={`Grupo ${index + 1}`}>
      <div className="meld-label">
        <span>Grupo {index + 1}</span>
        {invalid && <CircleAlert size={14} />}
      </div>
      <div className="tile-row">
        {editable && selected && selected !== group.tiles[0].id &&
          <button type="button" className="meld-add" aria-label={`Añadir al inicio del grupo ${index + 1}`}
            onClick={() => onTarget({ to: group.id, anchor: group.tiles[0].id, side: 'before' })}><ArrowLeftToLine size={17} /></button>}
        {group.tiles.map(tile => (
          <Tile key={tile.id} tile={tile} face={group.jokers[tile.id]} zone={group.id} selected={selected === tile.id}
            editable={editable} recent={recent?.tileIds.includes(tile.id)} onClick={() => onTarget({ to: group.id, anchor: tile.id })} />
        ))}
        {editable && <button type="button" className="meld-add" aria-label={`Añadir al grupo ${index + 1}`} onClick={() => onTarget({ to: group.id })}><Plus size={18} /></button>}
      </div>
    </section>
  )
}

function BoardSurface({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'board-background', data: { to: 'new' } satisfies DropTarget, disabled: !enabled,
  })
  return (
    <section ref={setNodeRef} className={`board felt ${isOver ? 'board-drop-hover' : ''}`} aria-label="Mesa de fichas" data-deal-board tabIndex={0}>
      {children}
    </section>
  )
}

function NewGroup({ enabled, selected, onAdd }: { enabled: boolean; selected: boolean; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'new-group', data: { to: 'new' } satisfies DropTarget, disabled: !enabled,
  })
  return (
    <button ref={setNodeRef} type="button" aria-label="Nuevo grupo" className={`new-group ${isOver ? 'drop-hover' : ''}`} disabled={!enabled} onClick={onAdd}>
      <span><Plus size={19} /> Nuevo grupo</span>
      {!selected && <small className="new-group-hint">Coloca aquí una ficha</small>}
    </button>
  )
}

function PlayerStrip({ players, current, self, dealing, reactions, incoming }: {
  players: PlayerView[]
  current?: string
  self: string
  dealing: boolean
  reactions: Record<string, LiveReaction>
  incoming?: IncomingMessage
}) {
  return (
    <ul className="match-players" style={{ '--player-count': players.length } as React.CSSProperties} aria-label="Jugadores">
      {players.map((player, index) => (
        <li key={player.id} data-deal-seat={player.id} className={`match-player ${player.id === current ? 'player-current' : ''}`}>
          <Avatar name={player.name} index={index} />
          <div className="min-w-0">
            <p className="player-name" title={player.name}>{player.name}{player.id === self && <span className="muted"> (tú)</span>}</p>
            <span className="player-caption">{dealing ? 'Repartiendo' : player.connected || current === undefined ? `${player.tileCount} fichas` : 'Reconectando…'}</span>
          </div>
          {player.id === current && <span className="current-dot" title="Turno actual" />}
          <PlayerReaction reaction={reactions[player.id]} />
          <MessagePreview incoming={incoming?.message.senderId === player.id ? incoming : undefined} />
        </li>
      ))}
    </ul>
  )
}

function Rack({
  tiles, selected, editable, concealed, carried, onTarget, onSort,
}: {
  tiles: TileData[]
  selected: string | null
  editable: boolean
  concealed: boolean
  carried: ReadonlySet<string>
  onTarget: (target: DropTarget) => void
  onSort: (by: 'value' | 'color') => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'rack', data: { to: 'rack' } satisfies DropTarget, disabled: !editable,
  })
  return (
    <section className="rack" aria-label="Tu atril">
      <div className="rack-heading">
        <h2>Tu atril <span className="rack-count">{tiles.length}</span></h2>
        <div className="rack-sorts">
          {editable && selected ? <>
            <button type="button" className="button button-quiet sort-button" aria-label="Mover al inicio del atril"
              disabled={!tiles.length || selected === tiles[0].id}
              onClick={() => onTarget({ to: 'rack', anchor: tiles[0].id, side: 'before' })}><ArrowLeftToLine size={15} /> Al inicio</button>
            <button type="button" className="button button-quiet sort-button" aria-label="Mover al final del atril"
              disabled={selected === tiles.at(-1)?.id} onClick={() => onTarget({ to: 'rack' })}><ArrowDownUp size={15} /> Al final</button>
          </> : <>
            <button type="button" className="button button-quiet sort-button" onClick={() => onSort('value')} disabled={!editable || tiles.length < 2} aria-label="Ordenar por número"><span>777</span> Número</button>
            <button type="button" className="button button-quiet sort-button" onClick={() => onSort('color')} disabled={!editable || tiles.length < 2} aria-label="Ordenar por color"><span>789</span> Color</button>
          </>}
        </div>
      </div>
      <div ref={setNodeRef} className={`rack-tray tile-row ${isOver ? 'drop-hover' : ''}`} role="group" aria-label="Fichas del atril"
        data-deal-rack aria-hidden={concealed || undefined} tabIndex={concealed ? -1 : 0}>
        {tiles.map(tile => <Tile key={tile.id} tile={tile} zone="rack" selected={selected === tile.id} editable={editable}
          movingWithGroup={carried.has(tile.id)} onClick={() => onTarget({ to: 'rack', anchor: tile.id })} />)}
      </div>
    </section>
  )
}

function EndPanel({ room, onLeave, pending, ready, leaveError }: MatchProps) {
  const end = room.game.end!
  const winners = room.players.filter(player => end.winners.includes(player.id)).map(player => player.name)
  const heading = end.winners.length > 1 ? 'Partida empatada' : end.winners.includes(room.selfId) ? '¡Has ganado!' : `Ganó ${winners[0] ?? 'tu rival'}`
  return (
    <section className="end-panel" aria-label="Resultado de la partida">
      <Trophy size={29} className="accent" />
      <div>
        <h2>{heading}</h2>
        <p className="muted">{end.reason === 'empty-rack' ? 'Victoria con el atril vacío.' : 'Se agotó el pozo y todos pasaron en la misma ronda.'}</p>
        <ul className="end-points">{room.players.map(player => <li key={player.id}>{player.name} · {end.points[player.id]} pts</li>)}</ul>
      </div>
      <button className="button button-secondary" disabled={pending || !ready} onClick={onLeave}><DoorOpen size={17} /> Volver al inicio</button>
      <ErrorNotice error={leaveError} />
    </section>
  )
}

function MatchTurn(props: MatchProps & {
  notice: string
  recentPlay?: RecentPlay
  order: string[]
  remember: (order: string[]) => void
  preferred: MeldKind
  prefer: (kind: MeldKind) => void
}) {
  const { room, ready, pending, notice, recentPlay, onConfirm, onDraw, order, remember, preferred, prefer } = props
  const { game } = room
  const self = room.players.find(player => player.id === room.selfId)!
  const current = room.players.find(player => player.id === game.currentPlayerId)
  const reducedMotion = useReducedMotion()
  const matchRef = useRef<HTMLElement>(null)
  const [intro] = useState(() => ({ started: game.dealRemainingMs > 0, endsAt: performance.now() + game.dealRemainingMs }))
  const [dealing, setDealing] = useState(intro.started)
  const showDeal = dealing && !reducedMotion && typeof Element.prototype.animate === 'function'
  const playing = !dealing && !game.end && game.currentPlayerId === room.selfId
  const editable = ready && !pending && !dealing && !game.end
  const [baseline] = useState(() => startDraft(game.table, orderRack(game.rack, order)))
  const [rules] = useState(() => turnRules(game.table, self.opened))
  const [draft, setDraft] = useState(baseline)
  const [moves, setMoves] = useState<Move[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [dragged, setDragged] = useState<string | null>(null)
  const [dragGroup, setDragGroup] = useState<TileData[] | null>(null)
  const holdTimer = useRef<number | undefined>(undefined)
  const [problem, setProblem] = useState<Problem | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 190, tolerance: 8 } }),
  )
  const tiles = [...draft.rack, ...draft.table.flatMap(group => group.tiles)]
  const dragTile = tiles.find(tile => tile.id === dragged)
  const selectedTile = tiles.find(tile => tile.id === selected)
  const selectedGroup = playing && selected ? findRackMeld(draft.rack, selected, preferred) : null
  const carried = dragGroup ? new Set(dragGroup.map(tile => tile.id)) : EMPTY_DRAG_GROUP
  const rackChanged = draft.rack.some((tile, index) => tile.id !== baseline.rack[index]?.id)
  const started = moves.length > 0 || rackChanged

  useEffect(() => {
    if (!intro.started) return
    const timer = window.setTimeout(() => setDealing(false), Math.max(0, intro.endsAt - performance.now()))
    return () => window.clearTimeout(timer)
  }, [intro])

  useEffect(() => () => window.clearTimeout(holdTimer.current), [])

  function keepOrder(rack: TileData[]) {
    const ids = rack.map(tile => tile.id)
    const moved = order.filter(id => !ids.includes(id))
    remember([...ids, ...moved])
  }

  function apply(move: Move) {
    if (!editable) return
    const rackOnly = move.to === 'rack' && ('tiles' in move || draft.rack.some(tile => tile.id === move.tile))
    if (!playing && !rackOnly) return
    if (!rackOnly && moves.length >= 2048) {
      setProblem({ message: 'Reinicia el turno para seguir editando la jugada.' })
      return
    }
    const result = applyMove(draft, rules, move)
    if (!result.ok) {
      setProblem(result.error)
      return
    }
    if (result.data === draft) return
    setDraft(result.data)
    setProblem(null)
    setSelected(null)
    if (rackOnly) keepOrder(result.data.rack)
    else setMoves([...moves, move])
  }

  function clickTarget(target: DropTarget) {
    if (target.anchor && target.anchor === selected) {
      setSelected(null)
    } else if (selected) {
      apply({ tile: selected, ...target })
    } else if (target.anchor) {
      setSelected(target.anchor)
    }
  }

  function stopWaitingForHold() {
    window.clearTimeout(holdTimer.current)
    holdTimer.current = undefined
  }

  function startDrag({ active, activatorEvent }: DragStartEvent) {
    const id = String(active.id)
    setSelected(null)
    setDragged(id)
    stopWaitingForHold()
    const group = findRackMeld(draft.rack, id, preferred)
    const elapsed = performance.now() - activatorEvent.timeStamp
    if (group && elapsed >= GROUP_HOLD_MS) setDragGroup(group)
    else if (group && activatorEvent.type === 'touchstart') {
      holdTimer.current = window.setTimeout(() => setDragGroup(group), GROUP_HOLD_MS - Math.max(0, elapsed))
    }
  }

  function moveDrag({ delta }: DragMoveEvent) {
    if (Math.hypot(delta.x, delta.y) > 8) stopWaitingForHold()
  }

  function endDrag() {
    stopWaitingForHold()
    setDragged(null)
    setDragGroup(null)
  }

  function drop({ active, over }: DragEndEvent) {
    endDrag()
    if (!over) return
    const target = over.data.current as DropTarget | undefined
    if (!target) return
    const rectangle = active.rect.current.translated
    const before = rectangle && rectangle.left + rectangle.width / 2 < over.rect.left + over.rect.width / 2
    const moved = dragGroup ? { tiles: dragGroup.map(tile => tile.id) } : { tile: String(active.id) }
    apply({ ...moved, ...target, side: before ? 'before' : 'after' })
  }

  function sort(by: 'value' | 'color') {
    const colorRank = (tile: TileData) => tile.color === 'joker' ? COLORS.length : COLORS.indexOf(tile.color)
    const rack = draft.rack.slice().sort((a, b) => {
      if (a.color === 'joker' || b.color === 'joker') return colorRank(a) - colorRank(b)
      const value = a.value - b.value
      const color = colorRank(a) - colorRank(b)
      return by === 'value' ? value || color : color || value
    })
    setDraft({ ...draft, rack })
    prefer(by === 'value' ? 'set' : 'run')
    keepOrder(rack)
    setSelected(null)
  }

  function reset() {
    setDraft(baseline)
    setMoves([])
    remember(baseline.rack.map(tile => tile.id))
    setSelected(null)
    setProblem(null)
  }

  const turnStatus = dealing ? 'Repartiendo fichas…' : game.end ? 'Partida terminada' : playing ? 'Tu turno' : `Turno de ${current?.name ?? 'otro jugador'}`
  return (
    <DndContext sensors={sensors} collisionDetection={targetsUnderPointer}
      accessibility={{
        screenReaderInstructions: { draggable: 'Pulsa Intro o Espacio para seleccionar la ficha. Ve al destino y actívalo para colocarla.' },
        announcements: {
          onDragStart: () => 'Ficha levantada.',
          onDragOver: ({ over }) => over ? 'Destino disponible.' : undefined,
          onDragEnd: ({ over }) => over ? 'Ficha soltada.' : 'Ficha devuelta a su lugar.',
          onDragCancel: () => 'Movimiento cancelado.',
        },
      }}
      onDragStart={startDrag}
      onDragMove={moveDrag}
      onDragCancel={endDrag}
      onDragEnd={drop}>
      <main ref={matchRef} className={`match ${showDeal ? 'match-dealing' : ''} ${intro.started && !dealing ? 'match-dealt' : ''}`}>
        <div className="match-top">
          <div className="table-heading">
            <div>
              <h1>Mesa de juego</h1>
              <div className="turn-line">
                <p className={`turn-state ${playing ? 'turn-yours' : ''}`} role="status">{turnStatus}</p>
                {notice && <span className="turn-notice" aria-hidden="true">{notice}</span>}
              </div>
            </div>
            <div className="pool-status" data-deal-pool data-empty={game.poolCount === 0} aria-label={`Pozo de fichas: ${game.poolCount}`}>
              <span className="pool-stack" aria-hidden="true"><i /><i /><i /></span>
              <div><strong>{game.poolCount}</strong><span>En el pozo</span></div>
            </div>
          </div>
          <PlayerStrip players={room.players} current={game.end || dealing ? undefined : game.currentPlayerId}
            self={room.selfId} dealing={showDeal} reactions={props.reactions} incoming={props.incoming} />
        </div>
        <BoardSurface enabled={Boolean(playing && editable)}>
          {game.end && <EndPanel {...props} />}
          {!game.end && !dealing && !selectedTile && <div className="board-note">
            {playing && !self.opened ? <><LockKeyhole size={16} /> Apertura: baja 30 puntos desde tu atril.</>
              : !playing && !current?.connected ? 'El jugador en turno está reconectando.'
              : playing ? 'Selecciona una ficha y pulsa su destino.' : 'Puedes ordenar tu atril mientras esperas.'}
            {game.poolCount === 0 && <span>Pasos consecutivos: {game.emptyPasses}/{room.players.length}</span>}
          </div>}
          {selectedTile && <div className="board-selection">
            <span role="status">{tileName(selectedTile)} · Pulsa el destino</span>
            {selectedGroup && <button type="button" className="button board-group-action"
              onClick={() => apply({ tiles: selectedGroup.map(tile => tile.id), to: 'new' })}>Bajar {selectedGroup.length} juntas</button>}
          </div>}
          <div className={`meld-grid ${draft.table.length ? '' : 'board-empty'}`}>
            {draft.table.map((group, index) => <Group key={group.id} group={group} index={index}
              canDrop={Boolean(playing && editable)}
              editable={Boolean(playing && editable && (self.opened || !group.tiles.some(tile => rules.tableIds.has(tile.id))))}
              selected={selected} invalid={problem?.groupId === group.id}
              recent={recentPlay?.groupIds.includes(group.id) ? recentPlay : undefined} onTarget={clickTarget} />)}
            {playing ? <NewGroup enabled={Boolean(editable)} selected={Boolean(selected)} onAdd={() => clickTarget({ to: 'new' })} />
              : !draft.table.length && !game.end && !dealing ? <p className="empty-label"><Layers3 size={30} /> La mesa está vacía</p> : null}
          </div>
        </BoardSurface>
        <div className="match-bottom">
          <Rack tiles={draft.rack} selected={selected} editable={Boolean(editable)} concealed={Boolean(showDeal)} carried={carried} onTarget={clickTarget} onSort={sort} />
          {!game.end && <div className="turn-actions">
            <ErrorNotice error={problem} />
            <div className="turn-buttons">
              <button type="button" className="button button-quiet reset-turn" disabled={!editable || !playing || !started} onClick={reset}><RotateCcw size={17} /> Reiniciar turno</button>
              <button type="button" className="button button-secondary" disabled={!editable || !playing} onClick={async () => setProblem(await onDraw())}>
                <Layers3 size={17} /> {game.poolCount ? 'Robar ficha' : 'Pasar'}
              </button>
              <button type="button" className="button button-primary" disabled={!editable || !playing || !moves.length} onClick={async () => setProblem(await onConfirm(moves))}>
                <Check size={18} /> Confirmar jugada
              </button>
            </div>
          </div>}
        </div>
      </main>
      {showDeal && <DealAnimation match={matchRef} endsAt={intro.endsAt} self={room.selfId} poolCount={game.poolCount} />}
      <DragOverlay dropAnimation={null}>{dragTile && <div className={`tile-overlay ${dragGroup ? 'tile-overlay-group' : ''}`}>
        {dragGroup ? <>
          <span className="overlay-fan">{dragGroup.slice(0, 4).map(tile => <TileVisual key={tile.id} tile={tile} />)}</span>
          <span className="overlay-count">{dragGroup.length} fichas</span>
        </> : <TileVisual tile={dragTile} />}
      </div>}</DragOverlay>
    </DndContext>
  )
}

function actionText(action: TurnAction, name: string) {
  if (action.kind === 'draw') return `${name} robó una ficha`
  if (action.kind === 'pass') return `${name} pasó el turno`
  return `${name} bajó ${action.tilesPlayed === 1 ? '1 ficha' : `${action.tilesPlayed} fichas`}`
}

export function Match(props: MatchProps) {
  const { room } = props
  const { turn, lastAction } = room.game
  const key = `rummy.rack.${room.code}.${room.selfId}`
  const [order, setOrder] = useState(() => loadOrder(key))
  const [preferred, prefer] = useState<MeldKind>('set')
  const [expiredTurn, setExpiredTurn] = useState<number | null>(null)
  const action = lastAction && lastAction.playerId !== room.selfId && expiredTurn !== turn ? lastAction : null
  const actor = action && room.players.find(player => player.id === action.playerId)
  const notice = action && actor ? actionText(action, actor.name) : ''

  useEffect(() => {
    if (!action) return
    const timeout = window.setTimeout(() => setExpiredTurn(turn), action.remainingMs)
    return () => window.clearTimeout(timeout)
  }, [action, turn])

  return <>
    <div className="sr-only" role="status">{notice}</div>
    <MatchTurn key={turn} {...props} notice={notice} recentPlay={action?.kind === 'play' ? action : undefined}
      order={order} preferred={preferred} prefer={prefer} remember={next => {
        setOrder(next)
        try { sessionStorage.setItem(key, JSON.stringify(next)) } catch { /* Private mode may disable storage. */ }
      }} />
  </>
}
