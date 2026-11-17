import { useCallback, useEffect, useRef, useState } from 'react'

const storageKey = 'rummy.sound'

type Note = readonly [time: number, pitch: number, duration: number, volume: number]

const cues = {
  turn: [[0, 440, .11, .08]],
  yourTurn: [[0, 523, .13, .10], [.08, 659, .16, .085]],
  chat: [[0, 880, .068, .065], [.062, 698, .11, .07]],
} satisfies Record<string, Note[]>

type AudioOutput = { context: AudioContext; volume: GainNode; lastChat: number }

function savedPreference() {
  try { return localStorage.getItem(storageKey) !== 'off' } catch { return true }
}

export function useGameSound() {
  const [enabled, setEnabled] = useState(savedPreference)
  const active = useRef(enabled)
  const output = useRef<AudioOutput | null>(null)

  const unlock = useCallback(() => {
    if (!active.current || typeof AudioContext !== 'function') return
    if (!output.current) {
      const context = new AudioContext()
      const volume = context.createGain()
      volume.gain.value = .65
      volume.connect(context.destination)
      output.current = { context, volume, lastChat: -Infinity }
    }
    const { context } = output.current
    if (context.state !== 'running') void context.resume().catch(() => {})
  }, [])

  useEffect(() => {
    window.addEventListener('click', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('click', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      if (output.current) void output.current.context.close().catch(() => {})
      output.current = null
    }
  }, [unlock])

  const toggle = useCallback(() => {
    const next = !active.current
    active.current = next
    setEnabled(next)
    if (output.current) output.current.volume.gain.value = next ? .65 : 0
    if (next) unlock()
    try { localStorage.setItem(storageKey, next ? 'on' : 'off') } catch { /* The tab can still mute audio. */ }
  }, [unlock])

  const play = useCallback((cue: keyof typeof cues) => {
    const audio = output.current
    if (!active.current || !audio || audio.context.state !== 'running') return
    const { context, volume } = audio
    const now = context.currentTime
    if (cue === 'chat') {
      if (now - audio.lastChat < .7) return
      audio.lastChat = now
    }
    for (const [offset, pitch, duration, level] of cues[cue]) {
      const start = now + offset
      const end = start + duration
      const tone = context.createOscillator()
      const envelope = context.createGain()
      tone.frequency.setValueAtTime(pitch, start)
      envelope.gain.setValueAtTime(.001, start)
      envelope.gain.linearRampToValueAtTime(level, start + .006)
      envelope.gain.exponentialRampToValueAtTime(.001, end)
      tone.connect(envelope).connect(volume)
      tone.onended = () => { tone.disconnect(); envelope.disconnect() }
      tone.start(start)
      tone.stop(end)
    }
  }, [])

  return { enabled, toggle, play }
}
