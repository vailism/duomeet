import { useEffect, useRef, useState } from 'react'
export function useBackgroundMusic() {
  const [enabled, setEnabled] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const oscRef = useRef<OscillatorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const filterRef = useRef<BiquadFilterNode | null>(null)

  useEffect(() => {
    return () => {
      try {
        oscRef.current?.stop()
      } catch {
      }
      oscRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [])

  async function start() {
    if (audioCtxRef.current) return

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    audioCtxRef.current = ctx

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()

    osc.type = 'sine'
    osc.frequency.value = 196

    filter.type = 'lowpass'
    filter.frequency.value = 800

    gain.gain.value = 0.0

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)

    osc.start()

    gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.6)

    oscRef.current = osc
    gainRef.current = gain
    filterRef.current = filter
  }

  async function stop() {
    const ctx = audioCtxRef.current
    const gain = gainRef.current
    if (!ctx) return

    if (gain) {
      gain.gain.cancelScheduledValues(ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.0, ctx.currentTime + 0.25)
    }

    setTimeout(() => {
      try {
        oscRef.current?.stop()
      } catch {
      }
      oscRef.current = null
      ctx.close().catch(() => {})
      audioCtxRef.current = null
      gainRef.current = null
      filterRef.current = null
    }, 350)
  }

  async function toggle() {
    if (!enabled) {
      await start()
      setEnabled(true)
    } else {
      await stop()
      setEnabled(false)
    }
  }

  return { enabled, toggle }
}
