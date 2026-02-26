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
    <div className="glass flex items-center justify-between rounded-2xl px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-[rgb(var(--grad-a))] to-[rgb(var(--grad-b))]" />
        <div>
          <div className="text-sm font-semibold">DuoMeet</div>
          <div className="text-xs text-slate-500">Private 1-to-1 calling</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-white dark:border-slate-700/60 dark:bg-slate-900/40 dark:hover:bg-slate-900"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button
          className={
            'rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur ' +
            (aryaMode
              ? 'border-pink-300/60 bg-pink-200/40 hover:bg-pink-200/55 dark:border-pink-200/40 dark:bg-pink-900/30'
              : 'border-slate-200/60 bg-white/70 hover:bg-white dark:border-slate-700/60 dark:bg-slate-900/40')
          }
          onClick={() => setAryaMode((v) => !v)}
        >
          Arya Mode
        </button>

        {user ? (
          <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900" onClick={logout}>
            Logout
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="relative min-h-dvh">
      <GradientBackdrop arya={aryaMode} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
        {header}

        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-200">{error}</div> : null}

        {view === 'auth' ? (
          <AuthCard onLogin={login} onRegister={register} />
        ) : null}

        {view === 'lobby' && user ? (
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
            <div className="glass rounded-2xl p-5">
              <div className="text-sm font-semibold">Create a room</div>
              <div className="mt-2 text-xs text-slate-500">Optional password (for extra privacy).</div>

              <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-300">Room password (optional)</label>
              <input
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur focus:border-pink-400 dark:border-slate-700/60 dark:bg-slate-900/40"
                placeholder="Leave empty for no password"
                type="password"
              />

              <button
                className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                onClick={createRoom}
              >
                Create room
              </button>

              {roomId ? (
                <div className="mt-4 rounded-xl border border-slate-200/60 bg-white/60 p-3 text-sm dark:border-slate-700/60 dark:bg-slate-900/40">
                  <div className="text-xs text-slate-500">Room code</div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="font-mono text-base font-semibold">{roomId}</div>
                    <button
                      className="rounded-lg border border-slate-200/70 bg-white/70 px-3 py-2 text-xs font-semibold hover:bg-white dark:border-slate-700/70 dark:bg-slate-900/40"
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

            <div className="glass rounded-2xl p-5">
              <div className="text-sm font-semibold">Join a room</div>
              <div className="mt-2 text-xs text-slate-500">Paste a room code your partner sent you.</div>

              <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-300">Room code</label>
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm font-mono outline-none backdrop-blur focus:border-pink-400 dark:border-slate-700/60 dark:bg-slate-900/40"
                placeholder="e.g. 8kF2aPqZxB"
              />

              <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-300">Room password (if set)</label>
              <input
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur focus:border-pink-400 dark:border-slate-700/60 dark:bg-slate-900/40"
                placeholder="Password (optional)"
                type="password"
              />

              <button
                className="mt-4 w-full rounded-xl bg-gradient-to-r from-[rgb(var(--grad-a))] to-[rgb(var(--grad-b))] px-4 py-3 text-sm font-semibold text-white hover:opacity-95"
                onClick={joinRoom}
              >
                Join room
              </button>

              <div className="mt-4 text-xs text-slate-500">
                Status: socket {socketConnected ? 'online' : 'offline'} • webrtc {connState}
              </div>
            </div>
            </div>

            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Recent calls</div>
                  <div className="mt-1 text-xs text-slate-500">Saved to MongoDB (room history)</div>
                </div>
                <button
                  className="rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-white dark:border-slate-700/60 dark:bg-slate-900/40"
                  onClick={loadHistory}
                  disabled={historyLoading}
                >
                  {historyLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>

              <div className="mt-4 grid gap-2 text-sm">
                {historyItems.length === 0 ? (
                  <div className="text-slate-500">No history yet.</div>
                ) : (
                  historyItems.map((it) => (
                    <div key={it._id} className="rounded-xl border border-slate-200/60 bg-white/60 px-3 py-2 dark:border-slate-700/60 dark:bg-slate-900/40">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-xs text-slate-500">{it.roomId}</div>
                        <div className="text-xs text-slate-500">{fmtTime(Number(it.durationSec || 0))}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {(it.participants || []).map((p: any) => p.displayName).join(' • ')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {view === 'call' && user ? (
          <div className="relative grid gap-4 lg:grid-cols-[1fr_360px]">
            <AryaBackgroundHearts enabled={aryaMode} />
            <HeartsBurst active={heartBurst} />

            <div className="flex flex-col gap-4">
              <div className="glass rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Room</div>
                    <div className="font-mono text-xs text-slate-500">{roomId}</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    socket {socketConnected ? 'online' : 'offline'} • webrtc {connState} • timer {fmtTime(callSeconds)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <VideoTile stream={localStream} label={meLabel} muted />
                <VideoTile stream={remoteStream} label={otherLabel} />
              </div>

              <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl p-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    className={
                      'rounded-xl px-4 py-2 text-sm font-semibold transition ' +
                      (micOn
                        ? 'bg-white/70 hover:bg-white dark:bg-slate-900/40 dark:hover:bg-slate-900'
                        : 'bg-red-600 text-white hover:bg-red-500')
                    }
                    onClick={toggleMic}
                  >
                    {micOn ? 'Mute' : 'Unmute'}
                  </button>

                  <button
                    className={
                      'rounded-xl px-4 py-2 text-sm font-semibold transition ' +
                      (camOn
                        ? 'bg-white/70 hover:bg-white dark:bg-slate-900/40 dark:hover:bg-slate-900'
                        : 'bg-red-600 text-white hover:bg-red-500')
                    }
                    onClick={toggleCam}
                  >
                    {camOn ? 'Camera off' : 'Camera on'}
                  </button>

                  <button
                    className={
                      'rounded-xl px-4 py-2 text-sm font-semibold transition ' +
                      (sharing
                        ? 'bg-pink-600 text-white hover:bg-pink-500'
                        : 'bg-white/70 hover:bg-white dark:bg-slate-900/40 dark:hover:bg-slate-900')
                    }
                    onClick={() => (sharing ? stopScreenShare() : startScreenShare())}
                  >
                    {sharing ? 'Stop share' : 'Share screen'}
                  </button>

                  <button
                    className={
                      'rounded-xl px-4 py-2 text-sm font-semibold transition ' +
                      (musicOn
                        ? 'bg-pink-600 text-white hover:bg-pink-500'
                        : 'bg-white/70 hover:bg-white dark:bg-slate-900/40 dark:hover:bg-slate-900')
                    }
                    onClick={() => toggleMusic().catch(() => setError('Audio blocked by browser — click again'))}
                  >
                    {musicOn ? 'Music on' : 'Music off'}
                  </button>
                </div>

                <button className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500" onClick={endCall}>
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

        <footer className="pt-2 text-center text-xs text-slate-500">
          DuoMeet • WebRTC + Socket.io • STUN: Google public
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
    <div className="grid gap-4 md:grid-cols-2">
      <div className="glass rounded-2xl p-6">
        <div className="text-sm font-semibold">Welcome to DuoMeet</div>
        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          A private 1-to-1 video call space for two.
        </div>
        <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white/60 p-4 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
          Tip: In production you must use HTTPS for camera/mic.
        </div>
      </div>

      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{mode === 'login' ? 'Login' : 'Create account'}</div>
          <button
            className="text-xs font-semibold text-pink-600 hover:underline dark:text-pink-300"
            onClick={() => {
              setLocalErr(null)
              setMode((m) => (m === 'login' ? 'register' : 'login'))
            }}
          >
            {mode === 'login' ? 'Need an account?' : 'Have an account?'}
          </button>
        </div>

        {localErr ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-200">{localErr}</div> : null}

        <form
          className="mt-4 flex flex-col gap-3"
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
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur focus:border-pink-400 dark:border-slate-700/60 dark:bg-slate-900/40"
                placeholder="e.g. Arya"
              />
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur focus:border-pink-400 dark:border-slate-700/60 dark:bg-slate-900/40"
              placeholder="you@example.com"
              type="email"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur focus:border-pink-400 dark:border-slate-700/60 dark:bg-slate-900/40"
              placeholder="At least 8 characters"
              type="password"
            />
          </div>

          <button
            disabled={busy}
            className="mt-2 w-full rounded-xl bg-gradient-to-r from-[rgb(var(--grad-a))] to-[rgb(var(--grad-b))] px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  )
}
