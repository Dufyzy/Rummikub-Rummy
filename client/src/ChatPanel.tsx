import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent, type RefObject } from 'react'
import { MessageCircle, Send, SmilePlus, X } from 'lucide-react'
import { CHAT_TEXT_LIMIT, QUICK_REACTIONS, REACTIONS, type ChatMessage, type Problem, type ReactionKind } from '../../server/protocol'
import { ReactionChoices, ReactionEmoji, reactionLabel } from './Reactions'
import { ErrorNotice } from './RoomScreens'
import './ChatPanel.css'

const timeFormat = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })
const REACTION_HOLD_MS = 500
const REACTION_MOVE_TOLERANCE = 10

type ReactionPress = { pointerId: number; startX: number; startY: number; timer: number }

type ChatPanelProps = {
  messages: ChatMessage[]
  selfId: string
  open: boolean
  ready: boolean
  trigger: RefObject<HTMLButtonElement | null>
  onClose: (returnFocus?: boolean) => void
  onSend: (text: string) => Promise<Problem | null>
  onReact: (kind: ReactionKind, messageId?: string) => Promise<Problem | null>
}

export function ChatPanel({ messages, selfId, open, ready, trigger, onClose, onSend, onReact }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [sending, setSending] = useState(false)
  const [reacting, setReacting] = useState(false)
  const [picker, setPicker] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const composer = useRef<HTMLInputElement>(null)
  const feed = useRef<HTMLDivElement>(null)
  const press = useRef<ReactionPress | null>(null)
  const pickerTrigger = useRef<HTMLButtonElement | null>(null)
  const pickerOptions = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const latestId = messages.at(-1)?.id
  const latestSender = messages.at(-1)?.senderId

  const cancelPress = useCallback(() => {
    if (!press.current) return
    window.clearTimeout(press.current.timer)
    press.current = null
  }, [])

  useEffect(() => {
    if (!open || !ready) return
    window.addEventListener('blur', cancelPress)
    return () => {
      window.removeEventListener('blur', cancelPress)
      cancelPress()
    }
  }, [cancelPress, open, ready])

  useLayoutEffect(() => {
    const list = feed.current
    if (open && list && (followLatest.current || latestSender === selfId)) list.scrollTop = list.scrollHeight
  }, [open, latestId, latestSender, selfId])

  useLayoutEffect(() => {
    if (open && picker) pickerOptions.current?.scrollIntoView({ block: 'nearest' })
  }, [open, picker])

  useLayoutEffect(() => {
    if (!open) return
    const desktop = window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches
    const target = desktop && composer.current && !composer.current.disabled ? composer.current : heading.current
    target?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    const element = panel.current
    if (!open || !element) return
    const dismissOutside = (event: MouseEvent) => {
      const path = event.composedPath()
      const control = trigger.current
      if (path.includes(element) || (control && path.includes(control))) return
      onClose(false)
    }
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
    document.addEventListener('click', dismissOutside, true)
    return () => {
      viewport?.removeEventListener('resize', fitViewport)
      viewport?.removeEventListener('scroll', fitViewport)
      document.removeEventListener('click', dismissOutside, true)
    }
  }, [onClose, open, trigger])

  function showPicker(messageId: string, control: HTMLButtonElement) {
    pickerTrigger.current = control
    setPicker(messageId)
  }

  function closePicker() {
    if (pickerOptions.current?.contains(document.activeElement)) pickerTrigger.current?.focus({ preventScroll: true })
    setPicker(null)
  }

  function startPress(event: PointerEvent<HTMLButtonElement>, messageId: string) {
    if (!event.isPrimary || event.button !== 0) return
    cancelPress()
    const { pointerId, clientX, clientY, currentTarget } = event
    currentTarget.setPointerCapture(pointerId)
    press.current = {
      pointerId, startX: clientX, startY: clientY,
      timer: window.setTimeout(() => {
        press.current = null
        if (currentTarget.isConnected) showPicker(messageId, currentTarget)
      }, REACTION_HOLD_MS),
    }
  }

  function movePress(event: PointerEvent<HTMLButtonElement>) {
    const active = press.current
    if (active?.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > REACTION_MOVE_TOLERANCE) cancelPress()
  }

  function endPress(event: PointerEvent<HTMLButtonElement>) {
    if (press.current?.pointerId === event.pointerId) cancelPress()
  }

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
      else if (messageId && pickerOptions.current?.dataset.messageId === messageId) closePicker()
    } finally {
      setReacting(false)
    }
  }

  return (
    <aside ref={panel} id="room-chat" className="chat-panel" aria-labelledby="chat-title" hidden={!open}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (picker) closePicker()
        else onClose()
      }}>
      <div className="chat-heading">
        <div className="chat-heading-icon"><MessageCircle size={20} /></div>
        <h2 ref={heading} id="chat-title" tabIndex={-1}>Chat de la sala</h2>
        <button type="button" className="button button-quiet icon-button" aria-label="Cerrar chat" onClick={() => onClose()}><X size={20} /></button>
      </div>
      <div className="chat-feed" ref={feed} role="log" aria-label="Mensajes del chat" aria-relevant="additions" tabIndex={0}
        onScroll={event => {
          cancelPress()
          const list = event.currentTarget
          followLatest.current = list.scrollHeight - list.scrollTop - list.clientHeight < 30
        }}>
        {!messages.length && <p className="chat-empty muted">Todavía no hay mensajes.</p>}
        {messages.map(message => {
          const own = message.senderId === selfId
          const latest = message.id === latestId
          const pickerOpen = message.id === picker
          return (
            <article className={`chat-message ${own ? 'chat-own-message' : ''}`} key={message.id}>
              <div className="chat-message-meta">
                <strong>{own ? 'Tú' : message.senderName}</strong>
                <time dateTime={new Date(message.sentAt).toISOString()}>{timeFormat.format(message.sentAt)}</time>
              </div>
              {latest ? <p className="chat-bubble">{message.text}</p> : (
                <button className="chat-bubble chat-hold-reaction" type="button" aria-expanded={pickerOpen}
                  aria-label={`Reaccionar a: ${message.text}`} title="Mantén pulsado para reaccionar" disabled={!ready}
                  onPointerDown={event => startPress(event, message.id)} onPointerMove={movePress}
                  onPointerUp={endPress} onPointerCancel={endPress} onLostPointerCapture={endPress}
                  onContextMenu={event => event.preventDefault()}
                  onClick={event => {
                    if (event.detail !== 0) return
                    if (pickerOpen) closePicker()
                    else showPicker(message.id, event.currentTarget)
                  }}>
                  {message.text}
                </button>
              )}
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
                {latest && (
                  <button className="chat-add-reaction" type="button" aria-label={`Reaccionar al mensaje de ${own ? 'ti' : message.senderName}`}
                    aria-expanded={pickerOpen} disabled={!ready}
                    onClick={event => pickerOpen ? closePicker() : showPicker(message.id, event.currentTarget)}>
                    <SmilePlus size={16} />
                  </button>
                )}
              </div>
              {pickerOpen && <div ref={pickerOptions} data-message-id={message.id}>
                <ReactionChoices disabled={!ready || reacting} onChoose={kind => void choose(kind, message.id)} />
              </div>}
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
          <input ref={composer} id="chat-message" type="text" value={text} maxLength={CHAT_TEXT_LIMIT} placeholder="Escribe un mensaje…"
            autoComplete="off" disabled={!ready} onChange={event => setText(event.target.value)} />
          <button className="button button-primary icon-button" type="submit" aria-label="Enviar mensaje"
            disabled={!ready || sending || !text.trim()}><Send size={19} /></button>
        </form>
      </div>
    </aside>
  )
}
