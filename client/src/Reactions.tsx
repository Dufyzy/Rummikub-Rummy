import { AnimatePresence, motion } from 'framer-motion'
import { Laugh, PartyPopper, ThumbsUp, Zap } from 'lucide-react'
import { REACTIONS, type LiveReaction, type ReactionKind } from '../../server/protocol'

const reactionInfo = {
  like: { label: 'Bien jugado', icon: ThumbsUp },
  laugh: { label: 'Me da risa', icon: Laugh },
  wow: { label: 'Sorpresa', icon: Zap },
  celebrate: { label: 'Celebrar', icon: PartyPopper },
}

export function reactionLabel(kind: ReactionKind) {
  return reactionInfo[kind].label
}

export function ReactionIcon({ kind, size = 18 }: { kind: ReactionKind; size?: number }) {
  const Icon = reactionInfo[kind].icon
  return <Icon size={size} aria-hidden="true" />
}

export function ReactionChoices({ disabled, onChoose }: { disabled: boolean; onChoose: (kind: ReactionKind) => void }) {
  return (
    <div className="reaction-choices" role="group" aria-label="Reacciones disponibles">
      {REACTIONS.map(kind => (
        <button type="button" key={kind} className={`reaction-choice reaction-${kind}`} aria-label={reactionLabel(kind)}
          title={reactionLabel(kind)} disabled={disabled} onClick={() => onChoose(kind)}>
          <ReactionIcon kind={kind} />
        </button>
      ))}
    </div>
  )
}

export function PlayerReaction({ reaction }: { reaction?: LiveReaction }) {
  return (
    <AnimatePresence>
      {reaction && <motion.span key={reaction.id} className={`player-reaction reaction-${reaction.kind}`}
        aria-hidden="true" title={reactionLabel(reaction.kind)}
        initial={{ opacity: 0, y: 6, scale: .85 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4 }} transition={{ duration: .18 }}>
        <ReactionIcon kind={reaction.kind} size={17} />
      </motion.span>}
    </AnimatePresence>
  )
}
