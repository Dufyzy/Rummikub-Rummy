import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Copy, Crown, DoorOpen, Link2, Play, Plus, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import type { LiveReaction, PlayerView, Problem, RoomView, Tile } from '../../server/protocol'
import { TileVisual } from './Tile'
import { PlayerReaction } from './Reactions'

const displaySet: Tile[] = [
  { id: 'preview-red', color: 'red', value: 8 },
  { id: 'preview-blue', color: 'blue', value: 8 },
  { id: 'preview-black', color: 'black', value: 8 },
]
const displayRun: Tile[] = [
  { id: 'preview-orange-10', color: 'orange', value: 10 },
  { id: 'preview-orange-11', color: 'orange', value: 11 },
  { id: 'preview-joker', color: 'joker', value: 0 },
  { id: 'preview-orange-13', color: 'orange', value: 13 },
]

export function ErrorNotice({ error }: { error: Problem | null }) {
  return error && <p className="error-notice" role="alert">{error.message}</p>
}

export function Entry({
  invite, ready, pending, error, onEnter,
}: {
  invite: string
  ready: boolean
  pending: boolean
  error: Problem | null
  onEnter: (name: string, code?: string) => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState(invite)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const button = (event.nativeEvent as SubmitEvent).submitter
    const joining = button?.getAttribute('value') === 'join' || (!button && Boolean(code))
    onEnter(name, joining ? code : undefined)
  }

  return (
    <motion.main className="screen entry" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <section className="entry-content">
        <p className="eyebrow"><Users size={15} /> 2 a 4 jugadores</p>
        <h1>Rummy<span className="accent">.</span></h1>
        <p className="screen-lede">Crea una sala, comparte el código y juega en tiempo real.</p>
        <form className="entry-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="player-name">Tu nombre</label>
            <input id="player-name" name="name" autoComplete="nickname" maxLength={24} placeholder="Escribe tu nombre" value={name} onChange={event => setName(event.target.value)} required />
          </div>
          <button className={invite ? 'button button-secondary' : 'button button-primary'} value="create" disabled={!ready || pending}>
            <Plus size={19} /> Crear sala
          </button>
          <div className="entry-join">
            <div className="field code-field">
              <label htmlFor="room-code">Código de sala</label>
              <input id="room-code" name="code" autoCapitalize="characters" autoComplete="off" maxLength={5} placeholder="ABCDE" value={code}
                onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  if (ready && !pending && code.length >= 4 && event.currentTarget.form?.reportValidity()) onEnter(name, code)
                }} />
            </div>
            <button className={invite ? 'button button-primary' : 'button button-secondary'} value="join" disabled={!ready || pending || code.length < 4}>
              Unirse a sala <ArrowRight size={17} />
            </button>
          </div>
          <ErrorNotice error={error} />
        </form>
      </section>
      <div className="showcase felt" aria-hidden="true">
        <div className="showcase-inner">
          <div className="showcase-tiles">
            <div className="showcase-set">{displaySet.map(tile => <TileVisual tile={tile} key={tile.id} />)}</div>
            <div className="showcase-run">{displayRun.map(tile => <TileVisual tile={tile} key={tile.id} />)}</div>
          </div>
        </div>
      </div>
    </motion.main>
  )
}

export function Avatar({ name, index }: { name: string; index: number }) {
  const initials = name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase()
  return <span className={`avatar avatar-${index % 4}`} aria-hidden="true">{initials}</span>
}

function LobbyPlayer({ player, room, index, reaction }: { player: PlayerView; room: RoomView; index: number; reaction?: LiveReaction }) {
  return (
    <li className="lobby-player">
      <Avatar name={player.name} index={index} />
      <div className="min-w-0">
        <p className="player-name">{player.name}{player.id === room.selfId && <span className="muted"> (tú)</span>}</p>
        <span className="player-caption">{player.connected ? 'Conectado' : 'Reconectando…'}</span>
      </div>
      {player.id === room.hostId && <span className="host-tag"><Crown size={15} /> Anfitrión</span>}
      <PlayerReaction reaction={reaction} />
    </li>
  )
}

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // The browser can deny clipboard permissions even on a secure origin.
    }
  }
  const activeElement = document.activeElement
  const input = document.createElement('textarea')
  input.value = value
  input.className = 'clipboard-field'
  input.readOnly = true
  document.body.append(input)
  input.focus({ preventScroll: true })
  input.select()
  input.setSelectionRange(0, value.length)
  try {
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable')
  } finally {
    input.remove()
    if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true })
  }
}

export function Lobby({
  room, reactions, ready, pending, error, onStart, onLeave,
}: {
  room: RoomView
  reactions: Record<string, LiveReaction>
  ready: boolean
  pending: boolean
  error: Problem | null
  onStart: () => void
  onLeave: () => void
}) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [copyError, setCopyError] = useState(false)
  const online = room.players.filter(player => player.connected).length
  const host = room.hostId === room.selfId
  const invite = new URL(window.location.pathname, window.location.origin)
  invite.searchParams.set('sala', room.code)
  const localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(invite.hostname)

  async function copy(kind: 'code' | 'link') {
    setCopyError(false)
    setCopied(null)
    try {
      await copyText(kind === 'code' ? room.code : invite.href)
      setCopied(kind)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <motion.main className="screen lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <section>
        <h1>Sala de espera<span className="accent">.</span></h1>
        <div className="lobby-list-heading"><h2>Jugadores</h2><span className="soft-pill"><Users size={16} /> {online}/4 conectados</span></div>
        <ul className="lobby-list">
          {room.players.map((player, index) => <LobbyPlayer key={player.id} player={player} index={index} room={room} reaction={reactions[player.id]} />)}
          {room.players.length < 4 && <li className="lobby-empty"><span className="avatar"><Plus size={19} /></span> {4 - room.players.length} {room.players.length === 3 ? 'asiento libre' : 'asientos libres'}</li>}
        </ul>
        <button className="button button-quiet leave-button" disabled={!ready || pending} onClick={onLeave}><DoorOpen size={17} /> Salir de la sala</button>
      </section>
      <section className="invite-card felt" aria-label="Invitar jugadores">
        <p className="eyebrow">Código de sala</p>
        <p className="invite-code" aria-label={`Código de sala ${room.code}`}>{room.code}</p>
        <div className="copy-actions">
          <button className="button button-secondary" onClick={() => void copy('code')}>{copied === 'code' ? <Check size={17} /> : <Copy size={17} />} Copiar código</button>
          <button className="button button-secondary" onClick={() => void copy('link')}>{copied === 'link' ? <Check size={17} /> : <Link2 size={17} />} Copiar enlace</button>
        </div>
        <span className="sr-only" role="status">{copied && (copied === 'code' ? 'Código copiado' : 'Enlace copiado')}</span>
        {localOnly && <p className="local-invite-note muted">Para invitar a otro dispositivo, comparte el código y la dirección de red o el enlace público del juego.</p>}
        {copyError && <input className="copy-fallback" aria-label="Enlace de invitación" readOnly value={invite.href} onFocus={event => event.target.select()} />}
        <div className="start-section">
          {host && <button className="button button-primary" disabled={!ready || online < 2 || pending} onClick={onStart}><Play size={17} /> Iniciar partida</button>}
          {(!host || online < 2) && <p className="muted">{host ? 'Se necesitan al menos dos jugadores conectados.' : 'El anfitrión iniciará la partida.'}</p>}
          <ErrorNotice error={error} />
        </div>
      </section>
    </motion.main>
  )
}
