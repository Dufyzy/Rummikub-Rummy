export const COLORS = ['red', 'blue', 'black', 'orange'] as const
export type Color = (typeof COLORS)[number]
export type Face = { color: Color; value: number }
export type Tile = { id: string } & (Face | { color: 'joker'; value: 0 })

export type Meld = {
  id: number
  tiles: Tile[]
  jokers: Record<string, Face>
}

export type Move = {
  tile: string
  to: number | 'rack' | 'new'
  anchor?: string
  side?: 'before' | 'after'
}

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

export interface ClientEvents {
  'room:create': (payload: { name: string }, reply: Reply<Seat>) => void
  'room:join': (payload: { name: string; code: string }, reply: Reply<Seat>) => void
  'room:leave': (reply: Reply) => void
  'game:start': (reply: Reply) => void
  'turn:confirm': (payload: { turn: number; moves: Move[] }, reply: Reply) => void
  'turn:draw': (payload: { turn: number }, reply: Reply) => void
}

export interface ServerEvents {
  'room:state': (room: RoomView) => void
  'session:expired': () => void
}

export function failure(message: string, groupId?: number): Result<never> {
  return { ok: false, error: { message, groupId } }
}
