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
        'group relative aspect-video w-full overflow-hidden rounded-2xl border bg-slate-950/20 transition-all duration-300 ' +
        (connected
          ? 'glow-connected border-[rgb(var(--grad-a))]/40'
          : 'border-[rgb(var(--border))]/40')
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
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 opacity-50">
            <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
            <span className="text-xs font-medium">Waiting for video…</span>
          </div>
        </div>
      )}

      {/* Label pill at bottom */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
        <div className={`status-dot ${stream ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        <span className="text-xs font-semibold text-white">{label}</span>
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  )
}
