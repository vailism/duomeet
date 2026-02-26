import { useEffect, useRef } from 'react'

type Props = {
  stream: MediaStream | null
  label: string
  muted?: boolean
}

export function VideoTile({ stream, label, muted }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = stream
  }, [stream])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-200/60 bg-slate-950/10 dark:border-slate-700/60">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full object-cover"
      />
      <div className="absolute bottom-2 left-2 rounded-full bg-black/45 px-3 py-1 text-xs text-white backdrop-blur">
        {label}
      </div>
    </div>
  )
}
