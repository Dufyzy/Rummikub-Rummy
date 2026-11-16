import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import express from 'express'
import { Server, type Socket } from 'socket.io'
import { confirmTurn, createGame, drawOrPass, type Game } from './gameLogic'
import {
  CHAT_HISTORY_LIMIT, CHAT_TEXT_LIMIT, REACTIONS, failure,
  type ChatMessage, type ClientEvents, type Move, type ReactionKind, type Reply, type RoomView, type Seat, type ServerEvents,
} from './protocol'

type SocketData = { seatToken?: string }
type GameSocket = Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>
type Player = {
  id: string
  name: string
  token: string
  socketId: string | null
  disconnectedAt: number | null
  lastMessageAt: number
  lastReactionAt: number
}
type Room = { code: string; hostId: string; players: Player[]; game: Game | null; messages: ChatMessage[] }
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
    const { tile, tiles, to, anchor, side } = entry as Record<string, unknown>
    if ((to !== 'new' && to !== 'rack' && !(typeof to === 'number' && Number.isSafeInteger(to) && to > 0))
      || (anchor !== undefined && !isTileId(anchor))
      || (side !== undefined && side !== 'before' && side !== 'after')) return null
    if (tiles === undefined && isTileId(tile)) moves.push({ tile, to, anchor, side })
    else if (tile === undefined && Array.isArray(tiles) && tiles.length >= 3 && tiles.length <= 13 && tiles.every(isTileId)) {
      moves.push({ tiles, to, anchor, side })
    } else return null
  }
  return moves
}

function isTileId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 20
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

function chatChannel(room: Room) {
  return `chat:${room.code}`
}

function sendChatHistory(socket: GameSocket, room: Room, player: Player) {
  socket.emit('chat:history', { code: room.code, selfId: player.id, messages: room.messages })
}

function bind(socket: GameSocket, room: Room, player: Player) {
  const previous = player.socketId
  player.socketId = socket.id
  player.disconnectedAt = null
  socket.data.seatToken = player.token
  void socket.join(chatChannel(room))
  if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect(true)
}

function addPlayer(socket: GameSocket, room: Room, name: string): Player {
  const player: Player = {
    id: randomUUID(), name, token: randomBytes(32).toString('base64url'),
    socketId: null, disconnectedAt: null, lastMessageAt: 0, lastReactionAt: 0,
  }
  room.players.push(player)
  seats.set(player.token, { room, player })
  bind(socket, room, player)
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
        dealRemainingMs: Math.max(0, game.dealEndsAt - Date.now()),
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
  else if (Date.now() < game.dealEndsAt) reply(failure('El reparto de fichas aún está en curso.'))
  else return { game, room: seat.room }
}

function enter(socket: GameSocket, payload: unknown, create: boolean, reply: Reply<Seat>) {
  if (membership(socket)) return reply(failure('Ya ocupas un asiento en una sala.'))
  const name = readName(payload)
  if (!name) return reply(failure('Escribe un nombre de hasta 24 caracteres.'))
  const code = create ? roomCode() : readCode(payload)
  if (!code) return reply(failure('Escribe un código de sala de 4 o 5 letras.'))
  const room: Room | undefined = create ? { code, hostId: '', players: [], game: null, messages: [] } : rooms.get(code)
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
  sendChatHistory(socket, room, player)
}

function isReaction(value: unknown): value is ReactionKind {
  return typeof value === 'string' && REACTIONS.some(reaction => reaction === value)
}

io.on('connection', socket => {
  const token: unknown = socket.handshake.auth.token
  if (typeof token === 'string' && token) {
    const seat = seats.get(token)
    if (seat) {
      bind(socket, seat.room, seat.player)
      publish(seat.room)
      sendChatHistory(socket, seat.room, seat.player)
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
    void socket.leave(chatChannel(seat.room))
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
  socket.on('chat:send', (payload, reply) => {
    if (typeof reply !== 'function') return
    const seat = membership(socket)
    if (!seat) return reply(failure('Únete a una sala para enviar mensajes.'))
    const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
    if (!text || text.length > CHAT_TEXT_LIMIT) {
      return reply(failure(`Escribe un mensaje de hasta ${CHAT_TEXT_LIMIT} caracteres.`))
    }
    const { room, player } = seat
    const sentAt = Date.now()
    if (sentAt - player.lastMessageAt < 400) return reply(failure('Espera un momento antes de enviar otro mensaje.'))
    player.lastMessageAt = sentAt
    const message: ChatMessage = { id: randomUUID(), senderId: player.id, senderName: player.name, text, sentAt, reactions: {} }
    room.messages.push(message)
    if (room.messages.length > CHAT_HISTORY_LIMIT) room.messages.shift()
    io.to(chatChannel(room)).emit('chat:message', { code: room.code, message })
    reply({ ok: true, data: null })
  })
  socket.on('chat:react', (payload, reply) => {
    if (typeof reply !== 'function') return
    const seat = membership(socket)
    if (!seat) return reply(failure('Únete a una sala para reaccionar.'))
    const kind: unknown = payload?.kind
    const messageId: unknown = payload?.messageId
    if (!isReaction(kind)) return reply(failure('Esa reacción no está disponible.'))
    const { room, player } = seat
    const target = messageId === undefined ? undefined : room.messages.find(message => message.id === messageId)
    if (messageId !== undefined && !target) return reply(failure('Ese mensaje ya no está disponible en la sala.'))
    const now = Date.now()
    if (now - player.lastReactionAt < 350) return reply(failure('Espera un momento antes de volver a reaccionar.'))
    player.lastReactionAt = now
    if (target) {
      const reactors = target.reactions[kind] ?? []
      target.reactions[kind] = reactors.includes(player.id)
        ? reactors.filter(id => id !== player.id) : [...reactors, player.id]
      io.to(chatChannel(room)).emit('chat:updated', { code: room.code, message: target })
    } else {
      io.to(chatChannel(room)).emit('chat:reaction', {
        code: room.code, reaction: { id: randomUUID(), senderId: player.id, senderName: player.name, kind },
      })
    }
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
