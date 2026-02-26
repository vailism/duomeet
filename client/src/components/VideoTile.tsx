import { useEffect, useRef } from 'react'

type Props = {
  stream: MediaStream | null
  label: string
  muted?: boolean
  connected?: boolean
}

export function VideoTile({ stream, label, muted, connected }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = stream
  }, [stream])

  return (
    <div
      className={
        'group glass hover-lift card-shimmer relative aspect-video w-full overflow-hidden rounded-2xl transition-all duration-500 ' +
        (connected ? 'glow-connected' : '')
      }
    >
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[rgb(var(--bg-deep))]/50">
          <div className="flex flex-col items-center gap-4 text-[rgb(var(--muted))]">
            <div className="rounded-full bg-[rgb(var(--gold))]/10 p-4">
              <svg className="h-8 w-8 text-[rgb(var(--gold))]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span className="text-sm font-medium">Waiting for video…</span>
          </div>
        </div>
      )}

      {/* Label pill */}
      <div className="absolute bottom-4 left-4 flex items-center gap-2.5 rounded-full bg-black/60 px-4 py-2 backdrop-blur-md border border-white/10">
        <span className={`status-dot ${stream ? 'online' : 'offline'}`} />
        <span className="text-xs font-semibold text-white tracking-wide">{label}</span>
      </div>

      {/* Hover gradient overlay */}
      <div className="video-overlay absolute inset-0 pointer-events-none" />
    </div>
  )
}
