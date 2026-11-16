import { useEffect, useRef, useState } from 'react'
import { BookOpen, CircleHelp, Dice5, Radio, X } from 'lucide-react'
import { io, type Socket } from 'socket.io-client'
import type { ClientEvents, Move, Problem, Result, RoomView, Seat, ServerEvents } from '../../server/protocol'
import { Match } from './Match'
import { Entry, Lobby } from './RoomScreens'

const socket: Socket<ServerEvents, ClientEvents> = io({ autoConnect: false })
const storageKey = 'rummy.seat'
const invite = new URLSearchParams(window.location.search).get('sala')?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) ?? ''

function readSeat(): Seat | null {
  try {
    const seat = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Seat | null
    return typeof seat?.token === 'string' && typeof seat.code === 'string' ? seat : null
  } catch {
    return null
  }
}

function storeSeat(seat: Seat | null) {
  socket.auth = seat ? { token: seat.token } : {}
  try {
    if (seat) sessionStorage.setItem(storageKey, JSON.stringify(seat))
    else sessionStorage.removeItem(storageKey)
  } catch {
    // The current connection can still play while session storage is unavailable.
  }
}

function RulesDialog({ dialog }: { dialog: React.RefObject<HTMLDialogElement | null> }) {
  return (
    <dialog ref={dialog} className="rules-dialog" aria-labelledby="rules-title">
      <div className="rules-title">
        <h2 id="rules-title"><BookOpen size={22} /> Cómo jugar</h2>
        <form method="dialog"><button className="button button-quiet icon-button" aria-label="Cerrar reglas"><X size={20} /></button></form>
      </div>
      <dl>
        <dt>Primera jugada</dt>
        <dd>Forma uno o más grupos desde tu atril. Deben sumar al menos 30 puntos.</dd>
        <dt>Trío o cuarteto</dt>
        <dd>Tres o cuatro fichas del mismo número y de colores distintos.</dd>
        <dt>Escalera</dt>
        <dd>Tres o más fichas consecutivas del mismo color, de menor a mayor. El 1 va antes del 2.</dd>
        <dt>Comodín</dt>
        <dd>Vale lo mismo que la ficha que representa. Tras abrir, coloca la ficha indicada encima del comodín para recuperarlo y úsalo en otro grupo en ese turno.</dd>
        <dt>Tu turno</dt>
        <dd>Selecciona una ficha y pulsa su destino. También puedes arrastrarla. En una pantalla táctil mantén pulsada la ficha para arrastrar y desliza enseguida para desplazarte. Confirma una jugada con al menos una ficha de tu atril, o roba y cede el turno.</dd>
        <dt>Victoria</dt>
        <dd>Gana quien vacía su atril. Con el pozo vacío, si todos pasan en una ronda, gana quien tenga menos puntos. Cada comodín en el atril vale 30 puntos.</dd>
      </dl>
    </dialog>
  )
}

export function App() {
  const [room, setRoom] = useState<RoomView | null>(null)
  const [seat, setSeat] = useState(readSeat)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [replaced, setReplaced] = useState(false)
  const commandPending = useRef(false)
  const rulesDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    storeSeat(readSeat())
    const onConnect = () => { setReady(true); setReplaced(false) }
    const onDisconnect = (reason: string) => {
      setReady(false)
      setReplaced(reason === 'io server disconnect')
    }
    const onExpired = () => {
      storeSeat(null)
      setSeat(null)
      setRoom(null)
      setProblem({ message: 'Tu asiento ha caducado. Crea una sala o vuelve a unirte.' })
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:state', setRoom)
    socket.on('session:expired', onExpired)
    socket.connect()
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:state', setRoom)
      socket.off('session:expired', onExpired)
      socket.disconnect()
    }
  }, [])

  async function run<T>(command: () => Promise<Result<T>>): Promise<Result<T> | undefined> {
    if (!socket.connected || commandPending.current) return
    commandPending.current = true
    setPending(true)
    try {
      return await command()
    } catch {
      return { ok: false, error: { message: 'El servidor no respondió. Revisa la conexión y vuelve a intentarlo.' } }
    } finally {
      commandPending.current = false
      setPending(false)
    }
  }

  async function enter(name: string, code?: string) {
    setProblem(null)
    const result = await run<Seat>(() => code === undefined
      ? socket.timeout(8000).emitWithAck('room:create', { name })
      : socket.timeout(8000).emitWithAck('room:join', { name, code }))
    if (result?.ok) {
      setSeat(result.data)
      storeSeat(result.data)
    } else if (result) setProblem(result.error)
  }

  async function start() {
    setProblem(null)
    const result = await run(() => socket.timeout(8000).emitWithAck('game:start'))
    if (result && !result.ok) setProblem(result.error)
  }

  async function leave() {
    setProblem(null)
    const result = await run(() => socket.timeout(8000).emitWithAck('room:leave'))
    if (result?.ok) {
      storeSeat(null)
      setSeat(null)
      setRoom(null)
    } else if (result) setProblem(result.error)
  }

  async function takeTurn(turn: number, moves?: Move[]): Promise<Problem | null> {
    const result = await run(() => moves
      ? socket.timeout(8000).emitWithAck('turn:confirm', { turn, moves })
      : socket.timeout(8000).emitWithAck('turn:draw', { turn }))
    return result && !result.ok ? result.error : null
  }

  const game = room?.game
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <div className="wordmark"><span className="wordmark-icon"><Dice5 size={22} /></span> Rummy</div>
          <div className="header-actions">
            {room && <span className="header-code" title="Código de sala">{room.code}</span>}
            <span className={`connection ${ready ? 'connection-up' : ''}`} role="status"><Radio size={15} /> <span>{ready ? 'En línea' : 'Sin conexión'}</span></span>
            <button className="button button-quiet help-button" onClick={() => rulesDialog.current?.showModal()}><CircleHelp size={18} /> <span>Cómo jugar</span></button>
          </div>
        </div>
      </header>
      {replaced && <div className="session-message" role="status">Tu asiento está activo en otra pestaña. <button onClick={() => socket.connect()}>Recuperar asiento</button></div>}
      {room && game ? <Match key={room.selfId} room={{ ...room, game }} ready={ready} pending={pending}
        onConfirm={moves => takeTurn(game.turn, moves)} onDraw={() => takeTurn(game.turn)}
        onLeave={() => void leave()} leaveError={problem} />
        : room ? <Lobby room={room} ready={ready} pending={pending} error={problem} onStart={() => void start()} onLeave={() => void leave()} />
        : seat ? <main className="screen recovery" role="status">Recuperando tu asiento en {seat.code}…</main>
        : <Entry invite={invite} ready={ready} pending={pending} error={problem} onEnter={(name, code) => void enter(name, code)} />}
      <RulesDialog dialog={rulesDialog} />
    </div>
  )
}
