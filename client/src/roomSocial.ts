import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { CHAT_HISTORY_LIMIT, REACTION_DISPLAY_MS } from '../../server/protocol'
import type { ChatMessage, ClientEvents, LiveReaction, Problem, ReactionKind, Result, ServerEvents } from '../../server/protocol'

type ChatState = {
  code: string
  selfId: string
  messages: ChatMessage[]
  open: boolean
  unread: number
}

export function useRoomSocial(socket: Socket<ServerEvents, ClientEvents>) {
  const [chat, setChat] = useState<ChatState | null>(null)
  const [reactions, setReactions] = useState<Record<string, LiveReaction>>({})
  const [announcement, setAnnouncement] = useState<LiveReaction | null>(null)
  const codeRef = useRef<string | null>(null)
  const timers = useRef(new Map<string, number>())

  const reset = useCallback(() => {
    codeRef.current = null
    timers.current.forEach(timer => window.clearTimeout(timer))
    timers.current.clear()
    setChat(null)
    setReactions({})
    setAnnouncement(null)
  }, [])

  const setOpen = useCallback((open: boolean) => {
    setChat(current => current && { ...current, open, unread: open ? 0 : current.unread })
  }, [])

  useEffect(() => {
    const expiry = timers.current
    const history: ServerEvents['chat:history'] = ({ code, selfId, messages }) => {
      codeRef.current = code
      setChat(current => {
        if (!current || current.code !== code || current.selfId !== selfId) {
          return { code, selfId, messages, open: false, unread: 0 }
        }
        const known = new Set(current.messages.map(message => message.id))
        const missed = current.open ? 0 : messages.filter(message => message.senderId !== selfId && !known.has(message.id)).length
        return { ...current, messages, unread: current.unread + missed }
      })
    }
    const receiveMessage: ServerEvents['chat:message'] = ({ code, message }) => {
      setChat(current => {
        if (!current || current.code !== code || current.messages.some(item => item.id === message.id)) return current
        return {
          ...current,
          messages: [...current.messages, message].slice(-CHAT_HISTORY_LIMIT),
          unread: current.unread + Number(!current.open && message.senderId !== current.selfId),
        }
      })
    }
    const updateMessage: ServerEvents['chat:updated'] = ({ code, message }) => {
      setChat(current => current?.code === code
        ? { ...current, messages: current.messages.map(item => item.id === message.id ? message : item) } : current)
    }
    const receiveReaction: ServerEvents['chat:reaction'] = ({ code, reaction }) => {
      if (codeRef.current !== code) return
      const id = reaction.senderId
      setReactions(current => ({ ...current, [id]: reaction }))
      setAnnouncement(reaction)
      window.clearTimeout(expiry.get(id))
      expiry.set(id, window.setTimeout(() => {
        setReactions(current => {
          const next = { ...current }
          delete next[id]
          return next
        })
        expiry.delete(id)
      }, REACTION_DISPLAY_MS))
    }

    socket.on('chat:history', history)
    socket.on('chat:message', receiveMessage)
    socket.on('chat:updated', updateMessage)
    socket.on('chat:reaction', receiveReaction)
    return () => {
      socket.off('chat:history', history)
      socket.off('chat:message', receiveMessage)
      socket.off('chat:updated', updateMessage)
      socket.off('chat:reaction', receiveReaction)
      expiry.forEach(timer => window.clearTimeout(timer))
      expiry.clear()
    }
  }, [socket])

  async function request(send: () => Promise<Result<null>>): Promise<Problem | null> {
    if (!socket.connected) return { message: 'El chat volverá al recuperar la conexión.' }
    try {
      const result = await send()
      return result.ok ? null : result.error
    } catch {
      return { message: 'El servidor tardó en responder. Revisa la conexión.' }
    }
  }

  return {
    chat, setOpen, reset, reactions, announcement,
    send: (text: string) => request(() => socket.timeout(8000).emitWithAck('chat:send', { text })),
    react: (kind: ReactionKind, messageId?: string) => request(() => socket.timeout(8000).emitWithAck('chat:react', { kind, messageId })),
  }
}
