import { useEffect, useMemo, useRef, useState } from 'react'
import { createAuthedSocket, type ChatMessage, type ChatTyping, type RoomState } from './lib/socket'
import { addLocalTracks, createPeerConnection, safeSetRemoteDescription } from './lib/webrtc'
import { VideoTile } from './components/VideoTile'
import { ChatPanel } from './components/ChatPanel'
import { SharedPresenceOrb } from './components/SharedPresenceOrb'
import { useBackgroundMusic } from './hooks/useBackgroundMusic'

type AuthUser = { userId: string; email: string; displayName: string }

type View = 'auth' | 'lobby' | 'call'

const STORAGE_TOKEN = 'duomeet_token'
const STORAGE_USER = 'duomeet_user'

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

  const [theme] = useState<'dark'>('dark')

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
  const [pendingShare, setPendingShare] = useState(false)

  const [connState, setConnState] = useState<RTCPeerConnectionState>('new')
  const [socketConnected, setSocketConnected] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState<ChatTyping | null>(null)

  const [callStartMs, setCallStartMs] = useState<number | null>(null)
  const [callSeconds, setCallSeconds] = useState(0)

  const { enabled: musicOn, toggle: toggleMusic } = useBackgroundMusic()

  const serverUrl = import.meta.env.VITE_SERVER_URL as string

  const meLabel = useMemo(() => (user ? `${user.displayName} (You)` : 'You'), [user])
  const otherLabel = useMemo(() => {
    const p = roomState?.participants.find((x) => x.userId !== user?.userId)
    return p ? p.displayName : 'Partner'
  }, [roomState, user?.userId])

  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

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

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    setLocalStream(stream)
    return stream
  }

  function createOrResetPeerConnection(params: { roomId: string; toSocketId: string }) {
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
      if (room.startedAt && !callStartMs) {
        const ms = new Date(room.startedAt).getTime()
        if (!Number.isNaN(ms)) setCallStartMs(ms)
      }
    })

    s.on('ready-for-offer', async ({ roomId: rid, to }) => {
      const pc = createOrResetPeerConnection({ roomId: rid, toSocketId: to })
      const stream = await ensureLocalMedia()
      addLocalTracks(pc, stream)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      s.emit('webrtc-offer', { to, sdp: offer, roomId: rid })
    })

    s.on('webrtc-offer', async ({ from, sdp, roomId: rid }) => {
      const pc = createOrResetPeerConnection({ roomId: rid, toSocketId: from })
      const stream = await ensureLocalMedia()
      addLocalTracks(pc, stream)

      await safeSetRemoteDescription(pc, sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      s.emit('webrtc-answer', { to: from, sdp: answer, roomId: rid })
    })

    s.on('webrtc-answer', async ({ from, sdp }) => {
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
    setPendingShare(false)
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
    if (!pcRef.current || connState !== 'connected') {
      setPendingShare(true)
      setError('Waiting for connection...')
      return
    }
    setPendingShare(false)
    setError(null)
    const pc = pcRef.current

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = display.getVideoTracks()[0]
      if (!track) return

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
    setPendingShare(false)
  }

  useEffect(() => {
    if (!pendingShare) return
    if (connState !== 'connected' || !pcRef.current) return
    startScreenShare()
  }, [pendingShare, connState])

  function sendChat(text: string) {
    if (!socketRef.current || !roomId) return
    socketRef.current.emit('chat-message', { roomId, message: text })
  }

  const typingDebounceRef = useRef<any>(null)
  function sendTyping(isTyping: boolean) {
    if (!socketRef.current || !roomId) return
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
    <header className="glass-panel flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-4">
        <img src="/logo.png" alt="DuoMeet" className="h-10 w-10 rounded-xl" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <div>
          <h1 className="font-serif text-lg font-semibold text-[rgb(var(--champagne))]">DuoMeet</h1>
          <p className="text-xs text-[rgb(var(--fg-muted))]">Private moments, together</p>
        </div>
      </div>

      {user && (
        <button
          className="btn-icon text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--rose-gold))]"
          onClick={logout}
          title="Sign out"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
          </svg>
        </button>
      )}
    </header>
  )

  return (
    <div className="relative min-h-dvh bg-[rgb(var(--bg-deep))] overflow-hidden">
      <div className="ambient-gradient" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        {header}

        {error && (
          <div className="glass-panel border-red-500/30 bg-red-500/5 px-5 py-3 text-sm text-red-400 animate-fade-in-scale">
            <div className="flex items-center gap-3">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              {error}
            </div>
          </div>
        )}

        {view === 'auth' && <AuthCard onLogin={login} onRegister={register} />}

        {view === 'lobby' && user && (
          <div className="grid gap-6 md:grid-cols-2 animate-fade-in-scale">
            <div className="glass-panel p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-[rgb(var(--rose-gold))]/10 flex items-center justify-center">
                  <svg className="h-5 w-5 text-[rgb(var(--rose-gold))]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <div>
                  <h2 className="font-serif text-lg font-medium text-[rgb(var(--champagne))]">Create a room</h2>
                  <p className="text-xs text-[rgb(var(--fg-muted))]">Start a private space for two</p>
                </div>
              </div>

              <label className="block text-xs font-medium text-[rgb(var(--fg-muted))] mb-2">Password (optional)</label>
              <input
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                className="input-luxury mb-6"
                placeholder="Leave empty for no password"
                type="password"
              />

              <button className="btn-luxury w-full" onClick={createRoom}>
                Create room
              </button>

              {roomId && (
                <div className="mt-6 p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="text-xs text-[rgb(var(--fg-muted))] mb-2">Room Code</div>
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono text-lg text-[rgb(var(--champagne))]">{roomId}</code>
                    <button
                      className="btn-icon text-[rgb(var(--rose-gold))]"
                      onClick={() => navigator.clipboard.writeText(roomId)}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="glass-panel p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-full bg-[rgb(var(--champagne))]/10 flex items-center justify-center">
                  <svg className="h-5 w-5 text-[rgb(var(--champagne))]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                  </svg>
                </div>
                <div>
                  <h2 className="font-serif text-lg font-medium text-[rgb(var(--champagne))]">Join a room</h2>
                  <p className="text-xs text-[rgb(var(--fg-muted))]">Enter your partner's code</p>
                </div>
              </div>

              <label className="block text-xs font-medium text-[rgb(var(--fg-muted))] mb-2">Room code</label>
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="input-luxury mb-4 font-mono"
                placeholder="e.g. 8kF2aPqZxB"
              />

              <label className="block text-xs font-medium text-[rgb(var(--fg-muted))] mb-2">Password (if set)</label>
              <input
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                className="input-luxury mb-6"
                placeholder="Optional"
                type="password"
              />

              <button className="btn-luxury w-full" onClick={joinRoom}>
                Join room
              </button>

              <div className="mt-6 flex items-center gap-3 text-xs">
                <span className={`status-dot ${socketConnected ? 'connected' : 'disconnected'}`} />
                <span className="text-[rgb(var(--fg-muted))]">
                  {socketConnected ? 'Connected' : 'Connecting...'}
                </span>
              </div>
            </div>
          </div>
        )}

        {view === 'call' && user && (
          <div className="relative grid gap-6 lg:grid-cols-[1fr_340px] animate-fade-in-scale">
            <div className="flex flex-col gap-6">
              <div className="glass-panel flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                  <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <div>
                    <div className="text-xs text-[rgb(var(--fg-muted))]">Room</div>
                    <code className="font-mono text-sm text-[rgb(var(--champagne))]">{roomId}</code>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`status-dot ${socketConnected ? 'connected' : 'disconnected'}`} />
                  <span className="font-mono text-sm text-[rgb(var(--fg-muted))]">{fmtTime(callSeconds)}</span>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <VideoTile stream={localStream} label={meLabel} muted isLocal />
                <VideoTile stream={remoteStream} label={otherLabel} />
              </div>

              {socketRef.current && (
                <SharedPresenceOrb
                  socket={socketRef.current}
                  roomId={roomId}
                  localStream={localStream}
                  remoteStream={remoteStream}
                  connected={connState === 'connected'}
                />
              )}

              <div className="glass-panel flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  <button
                    className={`btn-icon ${!micOn ? 'text-red-400 bg-red-500/10' : ''}`}
                    onClick={toggleMic}
                    title={micOn ? 'Mute' : 'Unmute'}
                  >
                    {micOn ? (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m18.364 18.364-3.067-3.067M3.75 7.5l.693-.694a2.25 2.25 0 0 1 3.182 0l.396.396M12 18.75a6 6 0 0 0 5.574-3.787M3.75 7.5V12a6 6 0 0 0 6 6m0 0v3.75m-3.75 0h7.5m1.125-16.5a3 3 0 0 1 3 3V12m-1.5-4.5L3 21" /></svg>
                    )}
                  </button>

                  <button
                    className={`btn-icon ${!camOn ? 'text-red-400 bg-red-500/10' : ''}`}
                    onClick={toggleCam}
                    title={camOn ? 'Camera off' : 'Camera on'}
                  >
                    {camOn ? (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 0 1-2.25-2.25V9m12.841 9.091L16.5 19.5m-1.409-.409 1.409.409M3 3l1.5 1.5m0 0 14.25 14.25" /></svg>
                    )}
                  </button>

                  <button
                    className={`btn-icon ${sharing ? 'text-violet-400 bg-violet-500/10' : ''}`}
                    onClick={() => (sharing ? stopScreenShare() : startScreenShare())}
                    title={sharing ? 'Stop sharing' : 'Share screen'}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" /></svg>
                  </button>

                  <button
                    className={`btn-icon ${musicOn ? 'text-amber-400 bg-amber-500/10' : ''}`}
                    onClick={() => toggleMusic().catch(() => setError('Audio blocked — click again'))}
                    title={musicOn ? 'Music on' : 'Music off'}
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" /></svg>
                  </button>
                </div>

                <button
                  className="flex items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-500/20 transition-all hover:bg-red-400"
                  onClick={endCall}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 3.75 18 6m0 0 2.25 2.25M18 6l2.25-2.25M18 6l-2.25 2.25m1.5 13.5c-8.284 0-15-6.716-15-15V4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.516 0 .966.351 1.091.852l1.106 4.423c.11.44-.054.902-.417 1.173l-1.293.97a1.062 1.062 0 0 0-.38 1.21 12.035 12.035 0 0 0 7.143 7.143c.441.162.928-.004 1.21-.38l.97-1.293a1.125 1.125 0 0 1 1.173-.417l4.423 1.106c.5.125.852.575.852 1.091V19.5a2.25 2.25 0 0 1-2.25 2.25h-2.25Z" /></svg>
                  End
                </button>
              </div>
            </div>

            <div className="h-[480px] lg:h-auto">
              <ChatPanel
                meUserId={user.userId}
                messages={messages}
                typing={typing}
                onSend={sendChat}
                onTyping={sendTyping}
              />
            </div>
          </div>
        )}

        <footer className="py-6 text-center text-xs text-[rgb(var(--fg-muted))]/50">
          DuoMeet — Private moments, together
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
    <div className="grid gap-6 md:grid-cols-2 animate-fade-in-scale">
      <div className="glass-panel p-8">
        <img src="/logo.png" alt="DuoMeet" className="h-14 w-14 rounded-xl mb-6" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />

        <h1 className="font-serif text-2xl font-semibold text-[rgb(var(--champagne))]">
          Welcome to DuoMeet
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
          A private video call space designed for two. Crystal clear audio, real-time chat, and a cinematic atmosphere — all in your browser.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            WebRTC encrypted
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-violet-500/10 px-3 py-1.5 text-xs text-violet-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            Screen sharing
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            Built-in chat
          </span>
        </div>
      </div>

      <div className="glass-panel p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-xl font-medium text-[rgb(var(--champagne))]">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h2>
          <button
            className="text-xs text-[rgb(var(--rose-gold))] hover:underline"
            onClick={() => {
              setLocalErr(null)
              setMode((m) => (m === 'login' ? 'register' : 'login'))
            }}
          >
            {mode === 'login' ? 'Need an account?' : 'Have an account?'}
          </button>
        </div>

        {localErr && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-400">
            {localErr}
          </div>
        )}

        <form
          className="flex flex-col gap-5"
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
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--fg-muted))] mb-2">Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-luxury"
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[rgb(var(--fg-muted))] mb-2">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-luxury"
              placeholder="you@example.com"
              type="email"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[rgb(var(--fg-muted))] mb-2">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-luxury"
              placeholder="At least 8 characters"
              type="password"
            />
          </div>

          <button
            disabled={busy}
            className="btn-luxury mt-2 w-full disabled:opacity-50"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
