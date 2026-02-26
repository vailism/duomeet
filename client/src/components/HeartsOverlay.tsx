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
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {hearts.map((h) => (
        <div
          key={h.id}
          className="heart text-rose-400"
          style={{
            left: `${h.left}%`,
            bottom: `${h.bottom}%`,
            fontSize: `${h.size}px`,
            opacity: h.opacity,
            animationDelay: `${h.delayMs}ms`,
          }}
        >
          &#x2764;
        </div>
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
        opacity: randomBetween(0.1, 0.2),
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
        <div
          key={h.id}
          className="heart text-rose-400/60"
          style={{
            left: `${h.left}%`,
            bottom: `${h.bottom}%`,
            fontSize: `${h.size}px`,
            opacity: h.opacity,
          }}
        >
          &#x2764;
        </div>
      ))}
    </div>
  )
}

/** Aurora gradient backdrop with animated blobs */
export function GradientBackdrop({ arya }: { arya: boolean }) {
  const blobs = useMemo(() => {
    if (arya) {
      return [
        { color: 'bg-rose-500', size: 'w-96 h-96', pos: 'top-[-8rem] left-[-6rem]', delay: '0s' },
        { color: 'bg-purple-500', size: 'w-80 h-80', pos: 'top-[20%] right-[-4rem]', delay: '4s' },
        { color: 'bg-pink-400', size: 'w-72 h-72', pos: 'bottom-[-4rem] left-[30%]', delay: '8s' },
      ]
    }
    return [
      { color: 'bg-teal-500', size: 'w-96 h-96', pos: 'top-[-8rem] left-[-6rem]', delay: '0s' },
      { color: 'bg-violet-600', size: 'w-80 h-80', pos: 'top-[20%] right-[-4rem]', delay: '6s' },
      { color: 'bg-indigo-500', size: 'w-72 h-72', pos: 'bottom-[-4rem] left-[30%]', delay: '12s' },
    ]
  }, [arya])

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[rgb(var(--bg))]/50 to-[rgb(var(--bg))]" />

      {/* Aurora blobs */}
      {blobs.map((b, i) => (
        <div
          key={i}
          className={`aurora-blob ${b.color} ${b.size} ${b.pos}`}
          style={{ animationDelay: b.delay }}
        />
      ))}

      {/* Noise overlay for texture */}
      <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")' }} />
    </div>
  )
}
