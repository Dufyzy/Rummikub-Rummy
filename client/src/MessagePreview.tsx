import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import type { IncomingMessage } from './roomSocial'

function MessageBubble({ incoming }: { incoming: IncomingMessage }) {
  const reduced = useReducedMotion()
  const [remaining] = useState(() => Math.max(0, incoming.startedAt + incoming.duration - performance.now()))
  const progress = Math.min(1, remaining / incoming.duration)
  const fresh = incoming.duration - remaining < 600
  const { message } = incoming
  return (
    <motion.div className="message-preview" aria-hidden="true"
      initial={fresh ? (reduced ? { opacity: 0 } : { opacity: 0, y: -16, scale: .7, rotate: -3 }) : false}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, scale: .95, transition: { duration: .2 } }}
      transition={{ type: 'spring', stiffness: 355, damping: 19, opacity: { duration: .2 } }}>
      <div className="message-preview-author"><MessageCircle size={15} /><strong>{message.senderName}</strong></div>
      <p>{message.text}</p>
      {!reduced && <span className="message-preview-track">
        <motion.span initial={{ scaleX: progress }} animate={{ scaleX: 0 }}
          transition={{ duration: remaining / 1000, ease: 'linear' }} />
      </span>}
    </motion.div>
  )
}

export function MessagePreview({ incoming }: { incoming?: IncomingMessage }) {
  return (
    <AnimatePresence>
      {incoming && <MessageBubble key={incoming.message.id} incoming={incoming} />}
    </AnimatePresence>
  )
}
