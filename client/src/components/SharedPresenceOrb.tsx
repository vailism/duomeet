import { useEffect, useRef, useState, useCallback } from 'react'

const WHISPER_MESSAGES = [
  'Miss you.',
  'Still here.',
  'Listening.',
  'With you.',
  'Always.',
  'Together.',
  '♥',
]

type FloatingMsg = {
  id: string
  text: string
  x: number
  y: number
}

type Props = {
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  connected: boolean
  socket: any
  roomId: string
}

export function SharedPresenceOrb({ localStream, remoteStream, connected, socket, roomId }: Props) {
  const [localLevel, setLocalLevel] = useState(0)
  const [remoteLevel, setRemoteLevel] = useState(0)
  const [ripples, setRipples] = useState<string[]>([])
  const [floatingMessages, setFloatingMessages] = useState<FloatingMsg[]>([])
  const orbRef = useRef<HTMLDivElement>(null)

  const localAnalyserRef = useRef<AnalyserNode | null>(null)
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)

  useEffect(() => {
    if (!localStream) return

    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(localStream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    localAnalyserRef.current = analyser

    return () => {
      audioCtx.close()
      localAnalyserRef.current = null
    }
  }, [localStream])

  useEffect(() => {
    if (!remoteStream) return

    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(remoteStream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    source.connect(analyser)
    remoteAnalyserRef.current = analyser

    return () => {
      audioCtx.close()
      remoteAnalyserRef.current = null
    }
  }, [remoteStream])

  useEffect(() => {
    if (!connected) return

    const dataArray = new Uint8Array(128)

    const analyze = () => {
      if (localAnalyserRef.current) {
        localAnalyserRef.current.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length
        setLocalLevel(Math.min(avg / 128, 1))
      }

      if (remoteAnalyserRef.current) {
        remoteAnalyserRef.current.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b) / dataArray.length
        setRemoteLevel(Math.min(avg / 128, 1))
      }

      animFrameRef.current = requestAnimationFrame(analyze)
    }

    analyze()
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [connected])

  const intensity = Math.min((localLevel + remoteLevel) / 1.5, 1)
  const intensityClass = intensity > 0.5 ? 'intensity-high' : intensity > 0.2 ? 'intensity-medium' : 'intensity-low'

  const handleOrbClick = useCallback(() => {
    const rippleId = `${Date.now()}`
    setRipples((prev) => [...prev, rippleId])
    setTimeout(() => setRipples((prev) => prev.filter((id) => id !== rippleId)), 1500)

    const msg = WHISPER_MESSAGES[Math.floor(Math.random() * WHISPER_MESSAGES.length)]

    const msgId = `${Date.now()}-local`
    setFloatingMessages((prev) => [
      ...prev,
      { id: msgId, text: msg, x: Math.random() * 60 + 20, y: -30 }
    ])
    setTimeout(() => setFloatingMessages((prev) => prev.filter((m) => m.id !== msgId)), 3500)

    if (socket && roomId) {
      socket.emit('orb-touch', { roomId, message: msg })
    }
  }, [socket, roomId])

  useEffect(() => {
    if (!socket) return

    const handlePartnerTouch = (data: { message: string }) => {
      const rippleId = `partner-${Date.now()}`
      setRipples((prev) => [...prev, rippleId])
      setTimeout(() => setRipples((prev) => prev.filter((id) => id !== rippleId)), 1500)

      const msgId = `${Date.now()}-partner`
      setFloatingMessages((prev) => [
        ...prev,
        { id: msgId, text: data.message, x: Math.random() * 60 + 20, y: -50 }
      ])
      setTimeout(() => setFloatingMessages((prev) => prev.filter((m) => m.id !== msgId)), 3500)
    }

    socket.on('orb-touch', handlePartnerTouch)
    return () => socket.off('orb-touch', handlePartnerTouch)
  }, [socket])

  const orbStyle: React.CSSProperties = {
    transform: `scale(${1 + intensity * 0.15})`,
    filter: `brightness(${1 + intensity * 0.3})`,
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center gap-6">
        <div className="presence-orb opacity-30" style={{ animationPlayState: 'paused' }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-sans text-white/40 tracking-widest uppercase">Waiting</span>
          </div>
        </div>
        <p className="font-serif text-sm italic text-[rgb(var(--fg-muted))]">
          Waiting for your partner…
        </p>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col items-center gap-6">
      {floatingMessages.map((msg) => (
        <span
          key={msg.id}
          className="floating-message"
          style={{ left: `${msg.x}%`, top: `${msg.y}px` }}
        >
          {msg.text}
        </span>
      ))}

      <div
        ref={orbRef}
        className={`presence-orb ${intensityClass}`}
        style={orbStyle}
        onClick={handleOrbClick}
        role="button"
        aria-label="Send a gentle touch to your partner"
      >
        {ripples.map((id) => (
          <div key={id} className="orb-ripple" />
        ))}
      </div>

      <p className="font-serif text-sm italic text-[rgb(var(--fg-muted))] tracking-wide">
        Together
      </p>
    </div>
  )
}
