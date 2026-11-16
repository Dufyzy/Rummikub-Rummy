import { useLayoutEffect, useRef, type RefObject } from 'react'
import { DEAL_DURATION_MS, STARTING_RACK_SIZE } from '../../server/protocol'

type Point = { x: number; y: number }

function randomOffset(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}

function center(element: Element): Point {
  const { x, y, width, height } = element.getBoundingClientRect()
  return { x: x + width / 2, y: y + height / 2 }
}

export function DealAnimation({
  match, endsAt, self, poolCount,
}: {
  match: RefObject<HTMLElement | null>
  endsAt: number
  self: string
  poolCount: number
}) {
  const layer = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = match.current
    const arena = root?.querySelector('[data-deal-board]')
    const rack = root?.querySelector('[data-deal-rack]')
    const pool = root?.querySelector('[data-deal-pool]')
    const players = root?.querySelectorAll<HTMLElement>('[data-deal-seat]')
    const container = layer.current
    if (!arena || !rack || !pool || !players?.length || !container) return

    const count = players.length * STARTING_RACK_SIZE + poolCount
    const backs = Array.from({ length: count }, () => {
      const tile = document.createElement('span')
      tile.className = 'deal-tile-back'
      return tile
    })
    container.replaceChildren(...backs)

    let animations: Animation[] = []
    function arrange() {
      animations.forEach(animation => animation.cancel())
      const elapsed = DEAL_DURATION_MS - Math.max(0, endsAt - performance.now())
      const board = arena!.getBoundingClientRect()
      const rackBox = rack!.getBoundingClientRect()
      const poolCenter = center(pool!)
      const pockets = Array.from(players!, player => player.dataset.dealSeat === self ? center(rack!) : center(player))
      const rackTiles = rack!.querySelectorAll<HTMLElement>('.tile-static')
      const pile = { x: board.x + board.width * .72, y: board.y + board.height * .52 }
      const width = Math.min(29, Math.max(10, Math.min(board.width / 17, board.height / 8)))
      const height = width * 1.28
      const columns = Math.max(6, Math.min(17, Math.floor(board.width / (width * 1.55))))
      const rows = Math.ceil(backs.length / columns)
      const dealt = players!.length * STARTING_RACK_SIZE
      function frame(at: number, point: Point, angle: number, scale: number, opacity = 1, easing = 'linear'): Keyframe {
        return {
          offset: at / DEAL_DURATION_MS,
          transform: `translate3d(${point.x - width / 2}px,${point.y - height / 2}px,0) rotate(${angle}deg) scale(${scale})`,
          opacity,
          easing,
        }
      }

      animations = backs.map((tile, index) => {
        tile.style.width = `${width}px`
        tile.style.height = `${height}px`
        const cell = (index * 47) % backs.length
        const spot = {
          x: board.x + width / 2 + (board.width - width) * ((cell % columns + .18 + .64 * randomOffset(index, 1)) / columns),
          y: board.y + height / 2 + (board.height - height) * ((Math.floor(cell / columns) + .18 + .64 * randomOffset(index, 2)) / rows),
        }
        const angle = -68 + randomOffset(index, 3) * 136
        const start = frame(0, spot, angle, 1)
        const flightEase = 'cubic-bezier(.32,.06,.26,1)'
        let steps: Keyframe[]
        if (index < dealt) {
          const seat = index % players!.length
          const round = Math.floor(index / players!.length)
          const leave = 475 + round * 89 + seat * 22
          const land = leave + 360
          const ownTile = players![seat].dataset.dealSeat === self ? rackTiles[round] : undefined
          const slot = ownTile?.getBoundingClientRect()
          const visible = slot && slot.top >= rackBox.top && slot.bottom <= rackBox.bottom
          const target = visible ? center(ownTile!) : pockets[seat]
          const size = visible ? .87 * Math.min(slot.width / width, slot.height / height) : .78
          steps = [
            start, frame(leave, spot, angle, 1, 1, flightEase),
            frame(land - 55, target, 0, size),
            frame(visible ? 3_325 : land, target, 0, visible ? size : .64, visible ? 1 : 0),
            frame(DEAL_DURATION_MS, target, 0, visible ? size : .64, 0),
          ]
        } else {
          const leave = 2_065 + (index % 10) * 28
          const stack = { x: pile.x + (index % 7 - 3) * 1.7, y: pile.y + (index % 5 - 2) * 1.5 }
          const edge = { x: poolCenter.x + (index % 7 - 3), y: poolCenter.y + (index % 5 - 2) }
          steps = [
            start, frame(leave, spot, angle, 1, 1, flightEase),
            frame(leave + 385, stack, -8, .92),
            frame(2_815, stack, -8, .92, 1, flightEase),
            frame(3_220, edge, -8, .48),
            frame(3_355, edge, -8, .38, 0),
            frame(DEAL_DURATION_MS, edge, -8, .38, 0),
          ]
        }
        const animation = tile.animate(steps, { duration: DEAL_DURATION_MS, fill: 'both' })
        animation.currentTime = elapsed
        return animation
      })
    }

    arrange()
    window.addEventListener('resize', arrange)
    return () => {
      window.removeEventListener('resize', arrange)
      animations.forEach(animation => animation.cancel())
      container.replaceChildren()
    }
  }, [endsAt, match, poolCount, self])

  return <div className="deal-layer" ref={layer} aria-hidden="true" />
}
