import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { MessageCircle, Send, SmilePlus, X } from 'lucide-react'
import { CHAT_TEXT_LIMIT, QUICK_REACTIONS, REACTIONS, type ChatMessage, type Problem, type ReactionKind } from '../../server/protocol'
import { ReactionChoices, ReactionEmoji, reactionLabel } from './Reactions'
import { ErrorNotice } from './RoomScreens'
import './ChatPanel.css'

const timeFormat = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })

type ChatPanelProps = {
  messages: ChatMessage[]
  selfId: string
  open: boolean
  ready: boolean
  onClose: () => void
  onSend: (text: string) => Promise<Problem | null>
  onReact: (kind: ReactionKind, messageId?: string) => Promise<Problem | null>
}

export function ChatPanel({ messages, selfId, open, ready, onClose, onSend, onReact }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [sending, setSending] = useState(false)
  const [reacting, setReacting] = useState(false)
  const [picker, setPicker] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const feed = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const latestId = messages.at(-1)?.id
  const latestSender = messages.at(-1)?.senderId

  useLayoutEffect(() => {
    const list = feed.current
    if (open && list && (followLatest.current || latestSender === selfId)) list.scrollTop = list.scrollHeight
  }, [open, latestId, latestSender, selfId])

  useEffect(() => {
    const element = panel.current
    if (!open || !element) return
    heading.current?.focus({ preventScroll: true })
    const viewport = window.visualViewport
    function fitViewport() {
      if (!viewport || !element) return
      element.style.setProperty('--chat-viewport-height', `${viewport.height}px`)
      element.style.setProperty('--chat-keyboard-inset', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`)
      element.dataset.compact = String(viewport.height < 285)
    }
    fitViewport()
    viewport?.addEventListener('resize', fitViewport)
    viewport?.addEventListener('scroll', fitViewport)
    return () => {
      viewport?.removeEventListener('resize', fitViewport)
      viewport?.removeEventListener('scroll', fitViewport)
    }
  }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || sending || !text.trim()) return
    const submitted = text
    setProblem(null)
    setSending(true)
    try {
      const result = await onSend(submitted)
      if (result) setProblem(result)
      else setText(current => current === submitted ? '' : current)
    } finally {
      setSending(false)
    }
  }

  async function choose(kind: ReactionKind, messageId?: string) {
    if (!ready || reacting) return
    setProblem(null)
    setReacting(true)
    try {
      const result = await onReact(kind, messageId)
      if (result) setProblem(result)
      else if (messageId) setPicker(null)
    } finally {
      setReacting(false)
    }
  }

  return (
    <aside ref={panel} id="room-chat" className="chat-panel" aria-labelledby="chat-title" hidden={!open}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (picker) setPicker(null)
        else onClose()
      }}>
      <div className="chat-heading">
        <div className="chat-heading-icon"><MessageCircle size={20} /></div>
        <h2 ref={heading} id="chat-title" tabIndex={-1}>Chat de la sala</h2>
        <button type="button" className="button button-quiet icon-button" aria-label="Cerrar chat" onClick={onClose}><X size={20} /></button>
      </div>
      <div className="chat-feed" ref={feed} role="log" aria-label="Mensajes del chat" aria-relevant="additions" tabIndex={0}
        onScroll={event => {
          const list = event.currentTarget
          followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 30
        }}>
        {!messages.length && <p className="chat-empty muted">Todavía no hay mensajes.</p>}
        {messages.map(message => {
          const own = message.senderId === selfId
          return (
            <article className={`chat-message ${own ? 'chat-own-message' : ''}`} key={message.id}>
              <div className="chat-message-meta">
                <strong>{own ? 'Tú' : message.senderName}</strong>
                <time dateTime={new Date(message.sentAt).toISOString()}>{timeFormat.format(message.sentAt)}</time>
              </div>
              <p className="chat-bubble">{message.text}</p>
              <div className="chat-message-reactions">
                {REACTIONS.map(kind => {
                  const users = message.reactions[kind]
                  return users?.length ? (
                    <button key={kind} type="button" className={`chat-reaction-count reaction-${kind}`}
                      aria-pressed={users.includes(selfId)} aria-label={`${reactionLabel(kind)}, ${users.length}`}
                      disabled={!ready || reacting} onClick={() => void choose(kind, message.id)}>
                      <ReactionEmoji kind={kind} /> {users.length}
                    </button>
                  ) : null
                })}
                <button className="chat-add-reaction" type="button" aria-label={`Reaccionar al mensaje de ${own ? 'ti' : message.senderName}`}
                  aria-expanded={picker === message.id} disabled={!ready} onClick={() => setPicker(picker === message.id ? null : message.id)}>
                  <SmilePlus size={16} />
                </button>
              </div>
              {picker === message.id && <ReactionChoices disabled={!ready || reacting} onChoose={kind => void choose(kind, message.id)} />}
            </article>
          )
        })}
      </div>
      <div className="chat-footer">
        <div className="chat-quick">
          <h3>Reacciones en la mesa</h3>
          <ReactionChoices choices={QUICK_REACTIONS} disabled={!ready || reacting} onChoose={kind => void choose(kind)} />
        </div>
        <ErrorNotice error={problem} />
        {!ready && <p className="muted chat-connection" role="status">Reconectando el chat…</p>}
        <form className="chat-form" onSubmit={event => void submit(event)}>
          <label className="sr-only" htmlFor="chat-message">Mensaje</label>
          <input id="chat-message" type="text" value={text} maxLength={CHAT_TEXT_LIMIT} placeholder="Escribe un mensaje…"
            autoComplete="off" disabled={!ready} onChange={event => setText(event.target.value)} />
          <button className="button button-primary icon-button" type="submit" aria-label="Enviar mensaje"
            disabled={!ready || sending || !text.trim()}><Send size={19} /></button>
        </form>
      </div>
    </aside>
  )
}
