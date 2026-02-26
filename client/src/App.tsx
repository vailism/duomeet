import { useEffect, useMemo, useRef, useState } from 'react'
import { createAuthedSocket, type ChatMessage, type ChatTyping, type RoomState } from './lib/socket'
import { addLocalTracks, createPeerConnection, safeSetRemoteDescription } from './lib/webrtc'
import { VideoTile } from './components/VideoTile'
import { ChatPanel } from './components/ChatPanel'
import { AryaBackgroundHearts, GradientBackdrop, HeartsBurst } from './components/HeartsOverlay'
import { useBackgroundMusic } from './hooks/useBackgroundMusic'

type AuthUser = { userId: string; email: string; displayName: string }

type View = 'auth' | 'lobby' | 'call'

const STORAGE_TOKEN = 'duomeet_token'
const STORAGE_USER = 'duomeet_user'
const STORAGE_THEME = 'duomeet_theme' // 'light' | 'dark'
const STORAGE_ARYA = 'duomeet_arya' // '0' | '1'

function fmtTime(totalSec: number) {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const [view, setView] = useState<View>('auth')
  const viewRef = useRef<View>('auth')
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_TOKEN))
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(STORAGE_USER)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  })

  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem(STORAGE_THEME) as any) || 'light')
  const [aryaMode, setAryaMode] = useState<boolean>(() => localStorage.getItem(STORAGE_ARYA) === '1')

  const socketRef = useRef<ReturnType<typeof createAuthedSocket> | null>(null)

  const [roomId, setRoomId] = useState('')
  const [roomPassword, setRoomPassword] = useState('')
  const roomIdRef = useRef('')
  const roomPasswordRef = useRef('')
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const remoteSocketIdRef = useRef<string | null>(null)

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)

  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [sharing, setSharing] = useState(false)

  const [connState, setConnState] = useState<RTCPeerConnectionState>('new')
  const [socketConnected, setSocketConnected] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState<ChatTyping | null>(null)

  const [callStartMs, setCallStartMs] = useState<number | null>(null)
  const [callSeconds, setCallSeconds] = useState(0)

  const [heartBurst, setHeartBurst] = useState(false)

  const { enabled: musicOn, toggle: toggleMusic } = useBackgroundMusic()

  const serverUrl = import.meta.env.VITE_SERVER_URL as string

  const meLabel = useMemo(() => (user ? `${user.displayName} (You)` : 'You'), [user])
  const otherLabel = useMemo(() => {
    const p = roomState?.participants.find((x) => x.userId !== user?.userId)
    return p ? p.displayName : 'Partner'
  }, [roomState, user?.userId])

  function handleGlowMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    e.currentTarget.style.setProperty('--mx', `${x}px`)
    e.currentTarget.style.setProperty('--my', `${y}px`)
  }

  function handleGlowLeave(e: React.MouseEvent<HTMLDivElement>) {
    e.currentTarget.style.setProperty('--mx', '50%')
    e.currentTarget.style.setProperty('--my', '20%')
  }

  // Apply theme classes on <html>
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('arya', aryaMode)
    localStorage.setItem(STORAGE_THEME, theme)
    localStorage.setItem(STORAGE_ARYA, aryaMode ? '1' : '0')
  }, [theme, aryaMode])

  // Simple auth bootstrap
  useEffect(() => {
    if (token && user) setView('lobby')
  }, [token, user])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    roomIdRef.current = roomId
  }, [roomId])

  useEffect(() => {
    roomPasswordRef.current = roomPassword
  }, [roomPassword])

  // Call timer
  useEffect(() => {
    if (!callStartMs) return
    setCallSeconds(Math.floor((Date.now() - callStartMs) / 1000))
    const t = setInterval(() => setCallSeconds(Math.floor((Date.now() - callStartMs) / 1000)), 1000)
    return () => clearInterval(t)
  }, [callStartMs])

  async function api(path: string, opts?: RequestInit) {
    const res = await fetch(`${serverUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Request failed')
    return data
  }

  async function register(email: string, password: string, displayName: string) {
    setError(null)
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) })
    localStorage.setItem(STORAGE_TOKEN, data.token)
    localStorage.setItem(STORAGE_USER, JSON.stringify(data.user))
    setToken(data.token)
    setUser(data.user)
    setView('lobby')
  }

  async function login(email: string, password: string) {
    setError(null)
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    localStorage.setItem(STORAGE_TOKEN, data.token)
    localStorage.setItem(STORAGE_USER, JSON.stringify(data.user))
    setToken(data.token)
    setUser(data.user)
    setView('lobby')
  }

  function logout() {
    cleanupCall()
    socketRef.current?.disconnect()
    socketRef.current = null
    localStorage.removeItem(STORAGE_TOKEN)
    localStorage.removeItem(STORAGE_USER)
    setToken(null)
    setUser(null)
    setView('auth')
  }

  async function ensureLocalMedia() {
    if (localStream) return localStream

    // HD-ish constraints (browser will adapt)
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    setLocalStream(stream)
    return stream
  }

  function createOrResetPeerConnection(params: { roomId: string; toSocketId: string }) {
    // Tear down old connection if any.
    pcRef.current?.close()
    pcRef.current = null
    setConnState('new')

    remoteSocketIdRef.current = params.toSocketId

    const pc = createPeerConnection({
      onIceCandidate: (candidate) => {
        socketRef.current?.emit('webrtc-ice', { to: params.toSocketId, candidate, roomId: params.roomId })
      },
      onTrack: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        setConnState(state)
        if (state === 'connected') {
          setHeartBurst(true)
          setTimeout(() => setHeartBurst(false), 1800)
          setCallStartMs((cur) => cur ?? Date.now())
        }
      },
    })

    pcRef.current = pc
    return pc
  }

  async function startSocket() {
    if (!token) throw new Error('Not logged in')
    if (socketRef.current) return socketRef.current

    const s = createAuthedSocket(token)
    socketRef.current = s

    s.on('connect', () => {
      setSocketConnected(true)
      // Auto-reconnect: if we were in a room, re-join.
      const rid = roomIdRef.current
      if (viewRef.current === 'call' && rid) {
        s.emit('join-room', { roomId: rid, password: roomPasswordRef.current }, (r) => {
          if (!r.ok) setError(r.error || 'Reconnect failed')
        })
      }
    })
    s.on('disconnect', () => setSocketConnected(false))

    s.on('room-state', ({ room }) => {
      setRoomState(room)
      // Server provides startedAt when 2 participants present.
      if (room.startedAt && !callStartMs) {
        const ms = new Date(room.startedAt).getTime()
        if (!Number.isNaN(ms)) setCallStartMs(ms)
      }
    })

    s.on('ready-for-offer', async ({ roomId: rid, to }) => {
      // We are the initiator.
      const pc = createOrResetPeerConnection({ roomId: rid, toSocketId: to })
      const stream = await ensureLocalMedia()
      addLocalTracks(pc, stream)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      s.emit('webrtc-offer', { to, sdp: offer, roomId: rid })
    })

    s.on('webrtc-offer', async ({ from, sdp, roomId: rid }) => {
      // We are the answerer.
      const pc = createOrResetPeerConnection({ roomId: rid, toSocketId: from })
      const stream = await ensureLocalMedia()
      addLocalTracks(pc, stream)

      await safeSetRemoteDescription(pc, sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      s.emit('webrtc-answer', { to: from, sdp: answer, roomId: rid })
    })

    s.on('webrtc-answer', async ({ from, sdp }) => {
      // Initiator receives answer.
      if (remoteSocketIdRef.current && remoteSocketIdRef.current !== from) return
      if (!pcRef.current) return
      await safeSetRemoteDescription(pcRef.current, sdp)
    })

    s.on('webrtc-ice', async ({ from, candidate }) => {
      if (remoteSocketIdRef.current && remoteSocketIdRef.current !== from) return
      if (!pcRef.current) return
      try {
        await pcRef.current.addIceCandidate(candidate)
      } catch {
        // Ignore ICE errors during reconnect/teardown.
      }
    })

    s.on('chat-message', (m) => {
      setMessages((prev) => [...prev.slice(-200), m])
    })

    s.on('chat-typing', (t) => {
      setTyping(t)
      setTimeout(() => setTyping((cur) => (cur?.from.userId === t.from.userId ? null : cur)), 1200)
    })

    s.on('peer-left', () => {
      setRemoteStream(null)
      setConnState('disconnected')
    })

    s.on('renegotiate', async () => {
      // Simplest reconnection strategy: rebuild PC and have initiator send a fresh offer.
      // Server will emit ready-for-offer to the first participant when the other rejoins.
      setRemoteStream(null)
      pcRef.current?.close()
      pcRef.current = null
      setConnState('new')
    })

    s.on('call-ended', () => {
      cleanupCall()
      setView('lobby')
    })

    return s
  }

  async function createRoom() {
    setError(null)
    const s = await startSocket()

    return new Promise<void>((resolve) => {
      s.emit('create-room', { password: roomPassword || undefined }, async (r) => {
        if (!r.ok || !r.roomId) {
          setError(r.error || 'Failed to create room')
          return resolve()
        }
        setRoomId(r.roomId)

        // Join is implicit for creator (server joins you). Now get local media and go to call view.
        await ensureLocalMedia().catch((e) => setError(e?.message || 'Camera/mic permission denied'))
        setView('call')
        resolve()
      })
    })
  }

  async function joinRoom() {
    setError(null)
    const rid = roomId.trim()
    if (!rid) return setError('Enter a room code')

    const s = await startSocket()
    s.emit('join-room', { roomId: rid, password: roomPassword || undefined }, async (r) => {
      if (!r.ok) return setError(r.error || 'Failed to join')

      await ensureLocalMedia().catch((e) => setError(e?.message || 'Camera/mic permission denied'))
      setView('call')
    })
  }

  function cleanupCall() {
    setMessages([])
    setTyping(null)
    setCallStartMs(null)
    setCallSeconds(0)
    setRemoteStream(null)
    remoteSocketIdRef.current = null

    pcRef.current?.close()
    pcRef.current = null
    setConnState('new')

    setSharing(false)

    // Stop screen share track if active
    // (We keep camera stream alive for a snappy experience.)
  }

  async function endCall() {
    const s = socketRef.current
    if (s && roomId) s.emit('end-call', { roomId })
    cleanupCall()
    setView('lobby')
  }

  function toggleMic() {
    const stream = localStream
    if (!stream) return
    const tracks = stream.getAudioTracks()
    tracks.forEach((t) => (t.enabled = !micOn))
    setMicOn((v) => !v)
  }

  function toggleCam() {
    const stream = localStream
    if (!stream) return
    const tracks = stream.getVideoTracks()
    tracks.forEach((t) => (t.enabled = !camOn))
    setCamOn((v) => !v)
  }

  async function startScreenShare() {
    if (!pcRef.current) return setError('Not connected yet')
    const pc = pcRef.current

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = display.getVideoTracks()[0]
      if (!track) return

      // Replace outgoing video track.
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      await sender?.replaceTrack(track)
      setSharing(true)

      track.onended = async () => {
        await stopScreenShare()
      }
    } catch (e: any) {
      setError(e?.message || 'Screen share failed')
    }
  }

  async function stopScreenShare() {
    if (!pcRef.current) return
    const pc = pcRef.current

    const camTrack = localStream?.getVideoTracks?.()[0]
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
    if (camTrack) await sender?.replaceTrack(camTrack)
    setSharing(false)
  }

  function sendChat(text: string) {
    if (!socketRef.current || !roomId) return
    socketRef.current.emit('chat-message', { roomId, message: text })
  }

  const typingDebounceRef = useRef<any>(null)
  function sendTyping(isTyping: boolean) {
    if (!socketRef.current || !roomId) return
    // Throttle typing events.
    if (typingDebounceRef.current) return
    socketRef.current.emit('chat-typing', { roomId, isTyping })
    typingDebounceRef.current = setTimeout(() => (typingDebounceRef.current = null), 700)
  }

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const data = await api('/api/rooms/history')
      setHistoryItems(data.items || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load history')
    } finally {
      setHistoryLoading(false)
    }
  }

  const header = (
    <div className="glass flex items-center justify-between rounded-2xl px-5 py-3.5 animate-fade-up">
      <div className="flex items-center gap-3">
        {/* Logo space — drop your logo image in /public/logo.svg */}
        <div className="logo-mark">
          <img src="/logo.svg" alt="DuoMeet" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
        <div>
          <div className="text-base font-bold tracking-tight grad-text">DuoMeet</div>
          <div className="text-[0.65rem] font-medium text-[rgb(var(--muted))]">Private 1&#8209;to&#8209;1 calling</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          className="btn-secondary flex items-center gap-1.5"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>
          )}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>

        {/* Arya mode toggle */}
        <button
          className={
            'btn-secondary flex items-center gap-1.5 ' +
            (aryaMode ? '!border-rose-400/50 !bg-rose-500/10 !text-rose-400' : '')
          }
          onClick={() => setAryaMode((v) => !v)}
        >
          <span className="text-sm">&#x2764;</span>
          Arya
        </button>

        {user ? (
          <button
            className="btn-secondary !border-red-400/30 !text-red-400 hover:!bg-red-500/10"
            onClick={logout}
          >
            Logout
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="relative min-h-dvh glow-surface" onMouseMove={handleGlowMove} onMouseLeave={handleGlowLeave}>
      <GradientBackdrop arya={aryaMode} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {header}

        {error ? (
          <div className="animate-fade-up rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400 backdrop-blur">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              {error}
            </div>
          </div>
        ) : null}

        {view === 'auth' ? (
          <AuthCard onLogin={login} onRegister={register} />
        ) : null}

        {view === 'lobby' && user ? (
          <div className="grid gap-4 stagger">
            <div className="grid gap-4 md:grid-cols-2">

            {/* ── Create Room Card ──────────────── */}
            <div className="glass hover-lift interactive-card rounded-2xl p-6 animate-fade-up">
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-[rgb(var(--grad-a))]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <div className="text-sm font-bold">Create a room</div>
              </div>
              <div className="mt-2 text-xs text-[rgb(var(--muted))]">Start a private call. Share the code with your partner.</div>

              <label className="mt-5 block text-xs font-semibold text-[rgb(var(--muted))]">Room password (optional)</label>
              <input
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                className="input-field mt-1.5"
                placeholder="Leave empty for no password"
                type="password"
              />

              <button className="btn-accent mt-5 w-full" onClick={createRoom}>
                Create room
              </button>

              {roomId ? (
                <div className="mt-4 rounded-xl border border-[rgb(var(--border))]/40 bg-[rgb(var(--bg))]/30 p-3.5">
                  <div className="text-[0.65rem] font-semibold uppercase tracking-widest text-[rgb(var(--muted))]">Room code</div>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <div className="font-mono text-lg font-bold grad-text">{roomId}</div>
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        await navigator.clipboard.writeText(roomId)
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* ── Join Room Card ────────────────── */}
            <div className="glass hover-lift interactive-card rounded-2xl p-6 animate-fade-up">
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-[rgb(var(--grad-b))]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                </svg>
                <div className="text-sm font-bold">Join a room</div>
              </div>
              <div className="mt-2 text-xs text-[rgb(var(--muted))]">Paste a room code your partner sent you.</div>

              <label className="mt-5 block text-xs font-semibold text-[rgb(var(--muted))]">Room code</label>
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="input-field mt-1.5 font-mono"
                placeholder="e.g. 8kF2aPqZxB"
              />

              <label className="mt-4 block text-xs font-semibold text-[rgb(var(--muted))]">Room password (if set)</label>
              <input
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                className="input-field mt-1.5"
                placeholder="Password (optional)"
                type="password"
              />

              <button className="btn-primary mt-5 w-full" onClick={joinRoom}>
                <span>Join room</span>
              </button>

              <div className="mt-4 flex items-center gap-3 text-xs">
                <span
                  className={`chip tooltip ${socketConnected ? 'chip-online' : 'chip-offline'}`}
                  data-tip="Socket.io connection to the server"
                >
                  <span className={`status-dot ${socketConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  Socket {socketConnected ? 'online' : 'offline'}
                </span>
                <span className="chip chip-offline tooltip" data-tip="WebRTC peer connection status">
                  WebRTC {connState === 'new' ? 'waiting' : connState}
                </span>
              </div>
            </div>
            </div>

            {/* ── Call History Card ─────────────── */}
            <div className="glass hover-lift interactive-card rounded-2xl p-6 animate-fade-up">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <svg className="h-5 w-5 text-[rgb(var(--muted))]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <div>
                    <div className="text-sm font-bold">Recent calls</div>
                    <div className="mt-0.5 text-[0.65rem] text-[rgb(var(--muted))]">Your call history</div>
                  </div>
                </div>
                <button
                  className="btn-secondary"
                  onClick={loadHistory}
                  disabled={historyLoading}
                >
                  {historyLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              <div className="mt-4 grid gap-2 text-sm">
                {historyItems.length === 0 ? (
                  <div className="rounded-xl border border-[rgb(var(--border))]/30 bg-[rgb(var(--bg))]/20 p-4 text-center text-xs text-[rgb(var(--muted))]">
                    No history yet — start your first call!
                  </div>
                ) : (
                  historyItems.map((it) => (
                    <div key={it._id} className="rounded-xl border border-[rgb(var(--border))]/30 bg-[rgb(var(--bg))]/20 px-4 py-3 transition-colors hover:bg-[rgb(var(--card-hover))]/40">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-xs text-[rgb(var(--muted))]">{it.roomId}</div>
                        <div className="chip chip-online">{fmtTime(Number(it.durationSec || 0))}</div>
                      </div>
                      <div className="mt-1.5 text-xs font-medium">
                        {(it.participants || []).map((p: any) => p.displayName).join(' &bull; ')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {view === 'call' && user ? (
          <div className="relative grid gap-4 lg:grid-cols-[1fr_360px] animate-fade-up">
            <AryaBackgroundHearts enabled={aryaMode} />
            <HeartsBurst active={heartBurst} />

            <div className="flex flex-col gap-4">
              {/* Room info bar */}
              <div className="glass hover-lift interactive-card rounded-2xl px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="logo-mark h-8 w-8 rounded-lg">
                      <img src="/logo.svg" alt="" className="h-full w-full" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-[rgb(var(--muted))]">Room</div>
                      <div className="font-mono text-sm font-bold grad-text">{roomId}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`chip tooltip ${socketConnected ? 'chip-online' : 'chip-offline'}`}
                      data-tip="Socket.io connection to the server"
                    >
                      <span className={`status-dot ${socketConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {socketConnected ? 'Connected' : 'Offline'}
                    </span>
                    <span className="chip chip-online font-mono">{fmtTime(callSeconds)}</span>
                  </div>
                </div>
              </div>

              {/* Video tiles */}
              <div className="grid gap-4 md:grid-cols-2">
                <VideoTile stream={localStream} label={meLabel} muted connected={connState === 'connected'} />
                <VideoTile stream={remoteStream} label={otherLabel} connected={connState === 'connected'} />
              </div>

              {/* Controls bar */}
              <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3.5">
                <div className="flex flex-wrap gap-2">
                  <button
                    className={
                      'btn-secondary flex items-center gap-1.5 ' +
                      (!micOn ? '!border-red-400/40 !bg-red-500/15 !text-red-400' : '')
                    }
                    onClick={toggleMic}
                  >
                    {micOn ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m18.364 18.364-3.067-3.067M3.75 7.5l.693-.694a2.25 2.25 0 0 1 3.182 0l.396.396M12 18.75a6 6 0 0 0 5.574-3.787M3.75 7.5V12a6 6 0 0 0 6 6m0 0v3.75m-3.75 0h7.5m1.125-16.5a3 3 0 0 1 3 3V12m-1.5-4.5L3 21" /></svg>
                    )}
                    {micOn ? 'Mute' : 'Unmute'}
                  </button>

                  <button
                    className={
                      'btn-secondary flex items-center gap-1.5 ' +
                      (!camOn ? '!border-red-400/40 !bg-red-500/15 !text-red-400' : '')
                    }
                    onClick={toggleCam}
                  >
                    {camOn ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-.409 1.409.409M3 3l1.5 1.5m0 0 14.25 14.25" /></svg>
                    )}
                    {camOn ? 'Cam off' : 'Cam on'}
                  </button>

                  <button
                    className={
                      'btn-secondary flex items-center gap-1.5 ' +
                      (sharing ? '!border-violet-400/40 !bg-violet-500/15 !text-violet-400' : '')
                    }
                    onClick={() => (sharing ? stopScreenShare() : startScreenShare())}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" /></svg>
                    {sharing ? 'Stop share' : 'Share'}
                  </button>

                  <button
                    className={
                      'btn-secondary flex items-center gap-1.5 ' +
                      (musicOn ? '!border-amber-400/40 !bg-amber-500/15 !text-amber-400' : '')
                    }
                    onClick={() => toggleMusic().catch(() => setError('Audio blocked by browser — click again'))}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" /></svg>
                    {musicOn ? 'Music on' : 'Music off'}
                  </button>
                </div>

                <button
                  className="flex items-center gap-1.5 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-500/25 transition-all hover:bg-red-400 hover:shadow-red-500/40"
                  onClick={endCall}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 3.75 18 6m0 0 2.25 2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z" /></svg>
                  End call
                </button>
              </div>
            </div>

            <div className="h-[520px] lg:h-auto">
              <ChatPanel
                meUserId={user.userId}
                messages={messages}
                typing={typing}
                onSend={sendChat}
                onTyping={sendTyping}
              />
            </div>
          </div>
        ) : null}

        <footer className="py-4 text-center text-[0.65rem] font-medium text-[rgb(var(--muted))]/60">
          DuoMeet &mdash; WebRTC &bull; Socket.io &bull; STUN: Google public
        </footer>
      </div>
    </div>
  )
}

function AuthCard(props: { onLogin: (email: string, password: string) => Promise<void>; onRegister: (email: string, password: string, displayName: string) => Promise<void> }) {
  const { onLogin, onRegister } = props

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  return (
    <div className="grid gap-4 md:grid-cols-2 stagger">
      {/* Welcome panel */}
      <div className="glass hover-lift interactive-card rounded-2xl p-7 animate-fade-up">
        <div className="logo-mark mb-5 h-12 w-12 rounded-xl">
          <img src="/logo.svg" alt="DuoMeet" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Welcome to <span className="grad-text">DuoMeet</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--muted))]">
          A private 1&#8209;to&#8209;1 video call space designed for two. Crystal clear audio, real&#8209;time chat, and a cozy atmosphere — all in your browser.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            End-to-end WebRTC
          </div>
          <div className="flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            Screen sharing
          </div>
          <div className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            Built-in chat
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[rgb(var(--border))]/30 bg-[rgb(var(--bg))]/20 p-4 text-xs text-[rgb(var(--muted))]">
          <strong className="font-bold text-[rgb(var(--fg))]">Tip:</strong> In production, HTTPS is required for camera/mic access.
        </div>
      </div>

      {/* Auth form */}
      <div className="glass hover-lift interactive-card rounded-2xl p-7 animate-fade-up">
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold">{mode === 'login' ? 'Sign in' : 'Create account'}</div>
          <button
            className="text-xs font-bold grad-text hover:opacity-80"
            onClick={() => {
              setLocalErr(null)
              setMode((m) => (m === 'login' ? 'register' : 'login'))
            }}
          >
            {mode === 'login' ? 'Need an account?' : 'Have an account?'}
          </button>
        </div>

        {localErr ? (
          <div className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-400">
            {localErr}
          </div>
        ) : null}

        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setLocalErr(null)
            setBusy(true)
            try {
              if (mode === 'login') {
                await onLogin(email, password)
              } else {
                if (!displayName.trim()) throw new Error('Display name is required')
                await onRegister(email, password, displayName)
              }
            } catch (err: any) {
              setLocalErr(err?.message || 'Auth failed')
            } finally {
              setBusy(false)
            }
          }}
        >
          {mode === 'register' ? (
            <div>
              <label className="block text-xs font-semibold text-[rgb(var(--muted))]">Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-field mt-1.5"
                placeholder="e.g. Arya"
              />
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-semibold text-[rgb(var(--muted))]">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field mt-1.5"
              placeholder="you@example.com"
              type="email"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[rgb(var(--muted))]">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field mt-1.5"
              placeholder="At least 8 characters"
              type="password"
            />
          </div>

          <button
            disabled={busy}
            className="btn-primary mt-2 w-full disabled:opacity-50"
          >
            <span>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</span>
          </button>
        </form>
      </div>
    </div>
  )
}
