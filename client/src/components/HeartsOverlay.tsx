import { useEffect, useMemo, useState } from 'react'

type Heart = { id: string; left: number; bottom: number; size: number; delayMs: number; opacity: number }

function randomBetween(min: number, max: number) {
  return Math.random() * (max - min) + min
}

export function HeartsBurst({ active }: { active: boolean }) {
  const [hearts, setHearts] = useState<Heart[]>([])

  useEffect(() => {
    if (!active) return

    const batch = Array.from({ length: 14 }).map((_, i) => ({
      id: `${Date.now()}-${i}`,
      left: randomBetween(10, 90),
      bottom: randomBetween(6, 18),
      size: randomBetween(14, 28),
      delayMs: i * 50,
      opacity: randomBetween(0.6, 1),
    }))

    setHearts(batch)

    const t = setTimeout(() => setHearts([]), 2800)
    return () => clearTimeout(t)
  }, [active])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-50">
      {hearts.map((h) => (
        <span
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
          ♥
        </span>
      ))}
    </div>
  )
}

export function AryaBackgroundHearts({ enabled }: { enabled: boolean }) {
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
        opacity: randomBetween(0.1, 0.25),
      }
      setItems((prev) => [...prev.slice(-14), h])

      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== h.id))
      }, 2800)
    }, 900)

    return () => clearInterval(interval)
  }, [enabled])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((h) => (
        <span
          key={h.id}
          className="heart"
          style={{
            left: `${h.left}%`,
            bottom: `${h.bottom}%`,
            fontSize: `${h.size}px`,
            opacity: h.opacity,
          }}
        >
          ♥
        </span>
      ))}
    </div>
  )
}

/** Elegant aurora gradient backdrop - rose gold themed */
export function GradientBackdrop({ arya }: { arya: boolean }) {
  const orbs = useMemo(() => {
    if (arya) {
      return [
        { bg: 'rgb(244, 182, 162)', size: 400, x: -100, y: -80, delay: 0 },
        { bg: 'rgb(251, 133, 153)', size: 350, x: '70%', y: '15%', delay: 5 },
        { bg: 'rgb(220, 140, 115)', size: 300, x: '30%', y: '60%', delay: 10 },
      ]
    }
    return [
      { bg: 'rgb(251, 207, 178)', size: 400, x: -100, y: -80, delay: 0 },
      { bg: 'rgb(205, 164, 131)', size: 350, x: '70%', y: '15%', delay: 6 },
      { bg: 'rgb(244, 182, 162)', size: 300, x: '30%', y: '60%', delay: 12 },
    ]
  }, [arya])

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base warm gradient */}
      <div 
        className="absolute inset-0"
        style={{
          background: `linear-gradient(
            135deg,
            rgb(var(--bg)) 0%,
            color-mix(in srgb, rgb(var(--gold-light)) 5%, rgb(var(--bg))) 50%,
            rgb(var(--bg)) 100%
          )`
        }}
      />

      {/* Aurora orbs */}
      {orbs.map((orb, i) => (
        <div
          key={i}
          className="aurora-orb"
          style={{
            background: orb.bg,
            width: orb.size,
            height: orb.size,
            left: typeof orb.x === 'number' ? orb.x : orb.x,
            top: typeof orb.y === 'number' ? orb.y : orb.y,
            animationDelay: `${orb.delay}s`,
          }}
        />
      ))}

      {/* Elegant noise texture */}
      <div 
        className="absolute inset-0 opacity-[0.02] mix-blend-overlay" 
        style={{ 
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` 
        }} 
      />

      {/* Subtle gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgb(var(--bg))]/40" />
    </div>
  )
}
