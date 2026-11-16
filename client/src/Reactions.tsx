import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { REACTIONS, type LiveReaction, type ReactionKind } from '../../server/protocol'

const reactionInfo = {
  like: { label: 'Bien jugado', emoji: '👍' },
  laugh: { label: 'Risa', emoji: '😂' },
  cry: { label: 'Llanto', emoji: '😭' },
  angry: { label: 'Enojo', emoji: '😡' },
  wow: { label: 'Sorpresa', emoji: '😮' },
  celebrate: { label: 'Celebrar', emoji: '🎉' },
}

export function reactionLabel(kind: ReactionKind) {
  return reactionInfo[kind].label
}

export function ReactionEmoji({ kind }: { kind: ReactionKind }) {
  return <span className="reaction-emoji" aria-hidden="true">{reactionInfo[kind].emoji}</span>
}

export function ReactionChoices({ choices = REACTIONS, disabled, onChoose }: {
  choices?: readonly ReactionKind[]
  disabled: boolean
  onChoose: (kind: ReactionKind) => void
}) {
  return (
    <div className="reaction-choices" role="group" aria-label="Reacciones disponibles">
      {choices.map(kind => (
        <button type="button" key={kind} className={`reaction-choice reaction-${kind}`} aria-label={reactionLabel(kind)}
          title={reactionLabel(kind)} disabled={disabled} onClick={() => onChoose(kind)}>
          <ReactionEmoji kind={kind} />
        </button>
      ))}
    </div>
  )
}

export function PlayerReaction({ reaction }: { reaction?: LiveReaction }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {reaction && <motion.span key={reaction.id} className={`player-reaction reaction-${reaction.kind}`}
        aria-hidden="true" title={reactionLabel(reaction.kind)}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: .55, rotate: -12 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -7, scale: .88 }}
        transition={{ type: 'spring', stiffness: 360, damping: 19, opacity: { duration: .16 } }}>
        <ReactionEmoji kind={reaction.kind} />
      </motion.span>}
    </AnimatePresence>
  )
}
