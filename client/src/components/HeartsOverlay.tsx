import { useEffect, useMemo, useState } from 'react'

type Heart = { id: string; left: number; bottom: number; size: number; delayMs: number; opacity: number }

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min
}

export function HeartsBurst({ active }: { active: boolean }) {
  const [hearts, setHearts] = useState<Heart[]>([])

  useEffect(() => {
    if (!active) return

    const batch = Array.from({ length: 12 }).map((_, i) => ({
      id: `${Date.now()}-${i}`,
      left: randomBetween(10, 90),
      bottom: randomBetween(6, 18),
      size: randomBetween(14, 28),
      delayMs: i * 60,
      opacity: randomBetween(0.6, 1),
    }))

    setHearts(batch)

    const t = setTimeout(() => setHearts([]), 2200)
    return () => clearTimeout(t)
  }, [active])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {hearts.map((h) => (
        <div
          key={h.id}
          className="heart"
          style={{
            left: `${h.left}%`,
            bottom: `${h.bottom}%`,
            fontSize: `${h.size}px`,
            opacity: h.opacity,
            animationDelay: `${h.delayMs}ms`,
          }}
        >
          ❤
        </div>
      ))}
    </div>
  )
}

export function AryaBackgroundHearts({ enabled }: { enabled: boolean }) {
  // Subtle hearts that appear occasionally in Arya Mode.
  const [items, setItems] = useState<Heart[]>([])

  useEffect(() => {
    if (!enabled) {
      setItems([])
      return
    }

    const interval = setInterval(() => {
      const h: Heart = {
        id: `${Date.now()}-${Math.random()}`,
        left: randomBetween(5, 95),
        bottom: randomBetween(0, 10),
        size: randomBetween(10, 18),
        delayMs: 0,
        opacity: randomBetween(0.12, 0.22),
      }
      setItems((prev) => [...prev.slice(-14), h])

      // Remove after animation.
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== h.id))
      }, 2200)
    }, 900)

    return () => clearInterval(interval)
  }, [enabled])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((h) => (
        <div
          key={h.id}
          className="heart"
          style={{
            left: `${h.left}%`,
            bottom: `${h.bottom}%`,
            fontSize: `${h.size}px`,
            opacity: h.opacity,
          }}
        >
          ❤
        </div>
      ))}
    </div>
  )
}

export function GradientBackdrop({ arya }: { arya: boolean }) {
  const classes = useMemo(() => {
    return arya
      ? 'from-fuchsia-500/30 via-pink-500/25 to-indigo-500/25'
      : 'from-indigo-500/25 via-fuchsia-500/15 to-pink-500/20'
  }, [arya])

  return (
    <div className={`absolute inset-0 -z-10 bg-gradient-to-br ${classes}`} />
  )
}
