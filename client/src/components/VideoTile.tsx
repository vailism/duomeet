import { useEffect, useRef } from 'react'

type Props = {
  stream: MediaStream | null
  label: string
  muted?: boolean
  isLocal?: boolean
}

export function VideoTile({ stream, label, muted, isLocal }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = stream
  }, [stream])

  return (
    <div className="video-container aspect-video w-full animate-fade-in-scale">
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className={`h-full w-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-[rgb(var(--fg-muted))]">
            <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center">
              <svg className="h-8 w-8 opacity-40" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span className="text-sm font-light tracking-wide">Waiting…</span>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 flex items-center gap-3">
        <span className={`status-dot ${stream ? 'connected' : 'disconnected'}`} />
        <span className="text-xs font-medium text-white/80 tracking-wide">{label}</span>
      </div>
    </div>
  )
}
