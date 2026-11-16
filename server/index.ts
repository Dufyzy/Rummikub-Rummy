import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import { confirmTurn, createGame, drawOrPass, type Game } from './gameLogic'
import { failure, type ClientEvents, type Move, type Reply, type RoomView, type Seat, type ServerEvents } from './protocol'

type SocketData = { seatToken?: string }
type GameSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>
type Player = { id: string; name: string; token: string; socketId: string | null; disconnectedAt: number | null }
type Room = { code: string; hostId: string; players: Player[]; game: Game | null }
type Membership = { room: Room; player: Player }

const app = express()
app.disable('x-powered-by')
app.get('/health', (_request, response) => response.json({ status: 'ok' }))
const http = createServer(app)
const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(http, {
  maxHttpBufferSize: 256_000,
})
const rooms = new Map<string, Room>()
const seats = new Map<string, Membership>()
const roomAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const lobbyGrace = 90_000
const abandonedGrace = 3_600_000

function readName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('name' in payload) || typeof payload.name !== 'string') return null
  const name = payload.name.trim().replace(/\s+/g, ' ')
  return name.length >= 1 && name.length <= 24 ? name : null
}

function readCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('code' in payload) || typeof payload.code !== 'string') return null
  const code = payload.code.trim().toUpperCase()
  return /^[A-Z]{4,5}$/.test(code) ? code : null
}

function readMoves(value: unknown): Move[] | null {
  if (!Array.isArray(value) || value.length > 2048) return null
  const moves: Move[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null
    const { tile, to, anchor, side } = entry as Record<string, unknown>
    if (typeof tile !== 'string' || tile.length > 20
      || (to !== 'new' && to !== 'rack' && !(typeof to === 'number' && Number.isSafeInteger(to) && to > 0))
      || (anchor !== undefined && (typeof anchor !== 'string' || anchor.length > 20))
      || (side !== undefined && side !== 'before' && side !== 'after')) return null
    moves.push({ tile, to, anchor, side } as Move)
  }
  return moves
}

function roomCode(): string {
  let code: string
  do {
    code = Array.from({ length: 5 }, () => roomAlphabet[randomInt(roomAlphabet.length)]).join('')
  } while (rooms.has(code))
  return code
}

function membership(socket: GameSocket): Membership | undefined {
  const seat = seats.get(socket.data.seatToken ?? '')
  return seat?.player.socketId === socket.id ? seat : undefined
}

function bind(socket: GameSocket, player: Player) {
  const previous = player.socketId
  player.socketId = socket.id
  player.disconnectedAt = null
  socket.data.seatToken = player.token
  if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect(true)
}

function addPlayer(socket: GameSocket, room: Room, name: string): Player {
  const player = { id: randomUUID(), name, token: randomBytes(32).toString('base64url'), socketId: null, disconnectedAt: null }
  room.players.push(player)
  seats.set(player.token, { room, player })
  bind(socket, player)
  return player
}

function forgetPlayer(room: Room, player: Player) {
  room.players = room.players.filter(item => item !== player)
  seats.delete(player.token)
  if (!room.players.length) rooms.delete(room.code)
  else if (room.hostId === player.id) room.hostId = (room.players.find(item => item.socketId) ?? room.players[0]).id
}

function publish(room: Room) {
  const game = room.game
  const players = game ? game.players.map(player => ({
    id: player.id, name: player.name, connected: room.players.some(seat => seat.id === player.id && seat.socketId),
    opened: player.opened, tileCount: player.rack.length,
  })) : room.players.map(player => ({
    id: player.id, name: player.name, connected: Boolean(player.socketId), opened: false, tileCount: 0,
  }))
  for (const player of room.players) {
    if (!player.socketId) continue
    const view: RoomView = {
      code: room.code,
      selfId: player.id,
      hostId: room.hostId,
      players,
      game: game && {
        turn: game.turn,
        currentPlayerId: game.players[game.current].id,
        poolCount: game.pool.length,
        emptyPasses: game.emptyPasses,
        table: game.table,
        rack: game.players.find(item => item.id === player.id)!.rack,
        end: game.end,
      },
    }
    io.to(player.socketId).emit('room:state', view)
  }
}

function activeTurn(socket: GameSocket, turn: unknown, reply: Reply): { game: Game; room: Room } | undefined {
  const seat = membership(socket)
  const game = seat?.room.game
  if (!seat || !game || game.end) reply(failure('No hay una partida en curso.'))
  else if (game.turn !== turn || game.players[game.current].id !== seat.player.id) reply(failure('El turno ya cambió.'))
  else return { game, room: seat.room }
}

function enter(socket: GameSocket, payload: unknown, create: boolean, reply: Reply<Seat>) {
  if (membership(socket)) return reply(failure('Ya ocupas un asiento en una sala.'))
  const name = readName(payload)
  if (!name) return reply(failure('Escribe un nombre de hasta 24 caracteres.'))
  const code = create ? roomCode() : readCode(payload)
  if (!code) return reply(failure('Escribe un código de sala de 4 o 5 letras.'))
  const room = create ? { code, hostId: '', players: [], game: null } : rooms.get(code)
  if (!room) return reply(failure('No encontramos una sala con ese código.'))
  if (room.game) return reply(failure('La partida de esa sala ya comenzó.'))
  if (room.players.length >= 4) return reply(failure('La sala está llena.'))
  const player = addPlayer(socket, room, name)
  if (create) {
    room.hostId = player.id
    rooms.set(room.code, room)
  }
  reply({ ok: true, data: { code: room.code, token: player.token } })
  publish(room)
}

io.on('connection', socket => {
  const token: unknown = socket.handshake.auth.token
  if (typeof token === 'string' && token) {
    const seat = seats.get(token)
    if (seat) {
      bind(socket, seat.player)
      publish(seat.room)
    } else socket.emit('session:expired')
  }

  socket.on('room:create', (payload, reply) => {
    if (typeof reply === 'function') enter(socket, payload, true, reply)
  })
  socket.on('room:join', (payload, reply) => {
    if (typeof reply === 'function') enter(socket, payload, false, reply)
  })
  socket.on('room:leave', reply => {
    if (typeof reply !== 'function') return
    const seat = membership(socket)
    if (!seat) return reply(failure('No tienes un asiento activo.'))
    if (seat.room.game && !seat.room.game.end) return reply(failure('Todavía hay una partida en curso.'))
    forgetPlayer(seat.room, seat.player)
    delete socket.data.seatToken
    reply({ ok: true, data: null })
    publish(seat.room)
  })
  socket.on('game:start', reply => {
    if (typeof reply !== 'function') return
    const seat = membership(socket)
    if (!seat || seat.room.hostId !== seat.player.id) return reply(failure('Solo el anfitrión puede iniciar la partida.'))
    const { room } = seat
    if (room.game) return reply(failure('La partida ya comenzó.'))
    const connected = room.players.filter(player => player.socketId)
    if (connected.length < 2) return reply(failure('Se necesitan al menos dos jugadores conectados.'))
    for (const player of room.players) if (!player.socketId) forgetPlayer(room, player)
    room.game = createGame(connected)
    publish(room)
    reply({ ok: true, data: null })
  })
  socket.on('turn:confirm', (payload, reply) => {
    if (typeof reply !== 'function') return
    const turn = activeTurn(socket, payload?.turn, reply)
    if (!turn) return
    const moves = readMoves(payload?.moves)
    if (!moves) return reply(failure('La jugada contiene movimientos inválidos.'))
    const result = confirmTurn(turn.game, moves)
    if (!result.ok) return reply(result)
    turn.room.game = result.data
    publish(turn.room)
    reply({ ok: true, data: null })
  })
  socket.on('turn:draw', (payload, reply) => {
    if (typeof reply !== 'function') return
    const turn = activeTurn(socket, payload?.turn, reply)
    if (!turn) return
    turn.room.game = drawOrPass(turn.game)
    publish(turn.room)
    reply({ ok: true, data: null })
  })
  socket.on('disconnect', () => {
    const seat = membership(socket)
    if (!seat) return
    seat.player.socketId = null
    seat.player.disconnectedAt = Date.now()
    publish(seat.room)
  })
})

setInterval(() => {
  const now = Date.now()
  for (const room of rooms.values()) {
    const expired = (player: Player, grace: number) => player.disconnectedAt !== null && now - player.disconnectedAt >= grace
    if (room.players.every(player => expired(player, abandonedGrace))) {
      for (const player of room.players) forgetPlayer(room, player)
    } else if (!room.game) {
      const stale = room.players.filter(player => expired(player, lobbyGrace))
      for (const player of stale) forgetPlayer(room, player)
      if (stale.length) publish(room)
    }
  }
}, 15_000).unref()

const port = Number(process.env.PORT ?? 3000)
http.listen(port, '0.0.0.0', () => {
  console.log(`Rummy escucha en el puerto ${port}`)
})
