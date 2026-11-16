export const COLORS = ['red', 'blue', 'black', 'orange'] as const
export type Color = (typeof COLORS)[number]
export type Face = { color: Color; value: number }
export type Tile = { id: string } & (Face | { color: 'joker'; value: 0 })

export type Meld = {
  id: number
  tiles: Tile[]
  jokers: Record<string, Face>
}

export const DEAL_DURATION_MS = 3_400
export const STARTING_RACK_SIZE = 14

export type MoveTarget = {
  to: number | 'rack' | 'new'
  anchor?: string
  side?: 'before' | 'after'
}

export type Move = MoveTarget & ({ tile: string } | { tiles: string[] })

export type Problem = { message: string; groupId?: number }
export type Result<T> = { ok: true; data: T } | { ok: false; error: Problem }
export type Reply<T = null> = (result: Result<T>) => void

export type Seat = { code: string; token: string }
export type PlayerView = {
  id: string
  name: string
  connected: boolean
  opened: boolean
  tileCount: number
}

export type GameEnd = {
  reason: 'empty-rack' | 'blocked'
  winners: string[]
  points: Record<string, number>
}

export type GameView = {
  turn: number
  dealRemainingMs: number
  currentPlayerId: string
  poolCount: number
  emptyPasses: number
  table: Meld[]
  rack: Tile[]
  end: GameEnd | null
}

export type RoomView = {
  code: string
  selfId: string
  hostId: string
  players: PlayerView[]
  game: GameView | null
}

export const CHAT_TEXT_LIMIT = 280
export const CHAT_HISTORY_LIMIT = 80
export const REACTION_DISPLAY_MS = 2400
export const REACTIONS = ['like', 'laugh', 'wow', 'celebrate'] as const
export type ReactionKind = (typeof REACTIONS)[number]

export type ChatMessage = {
  id: string
  senderId: string
  senderName: string
  text: string
  sentAt: number
  reactions: Partial<Record<ReactionKind, string[]>>
}

export type LiveReaction = {
  id: string
  senderId: string
  senderName: string
  kind: ReactionKind
}

export interface ClientEvents {
  'room:create': (payload: { name: string }, reply: Reply<Seat>) => void
  'room:join': (payload: { name: string; code: string }, reply: Reply<Seat>) => void
  'room:leave': (reply: Reply) => void
  'game:start': (reply: Reply) => void
  'turn:confirm': (payload: { turn: number; moves: Move[] }, reply: Reply) => void
  'turn:draw': (payload: { turn: number }, reply: Reply) => void
  'chat:send': (payload: { text: string }, reply: Reply) => void
  'chat:react': (payload: { kind: ReactionKind; messageId?: string }, reply: Reply) => void
}

export interface ServerEvents {
  'room:state': (room: RoomView) => void
  'session:expired': () => void
  'chat:history': (payload: { code: string; selfId: string; messages: ChatMessage[] }) => void
  'chat:message': (payload: { code: string; message: ChatMessage }) => void
  'chat:updated': (payload: { code: string; message: ChatMessage }) => void
  'chat:reaction': (payload: { code: string; reaction: LiveReaction }) => void
}

export function failure(message: string, groupId?: number): Result<never> {
  return { ok: false, error: { message, groupId } }
}
