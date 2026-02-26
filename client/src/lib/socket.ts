import { io, Socket } from 'socket.io-client'

type ServerToClientEvents = {
  'server-ready': (p: { ok: boolean }) => void
  'room-state': (p: { room: RoomState }) => void
  'ready-for-offer': (p: { roomId: string; to: string }) => void
  renegotiate: (p: { reason: string }) => void
  'webrtc-offer': (p: { from: string; sdp: RTCSessionDescriptionInit; roomId: string }) => void
  'webrtc-answer': (p: { from: string; sdp: RTCSessionDescriptionInit; roomId: string }) => void
  'webrtc-ice': (p: { from: string; candidate: RTCIceCandidateInit; roomId: string }) => void
  'chat-message': (p: ChatMessage) => void
  'chat-typing': (p: ChatTyping) => void
  'peer-left': (p: { roomId: string; userId: string; reason?: string }) => void
  'call-ended': (p: { roomId: string; reason: string; by: { userId: string; displayName: string } }) => void
}

type ClientToServerEvents = {
  'create-room': (p: { password?: string } | undefined, ack?: (r: { ok: boolean; roomId?: string; error?: string }) => void) => void
  'join-room': (
    p: { roomId: string; password?: string },
    ack?: (r: { ok: boolean; error?: string; room?: RoomState; reconnected?: boolean }) => void,
  ) => void
  'leave-room': (p: { roomId: string }, ack?: (r: { ok: boolean }) => void) => void
  'end-call': (p: { roomId: string }, ack?: (r: { ok: boolean }) => void) => void
  'webrtc-offer': (p: { to: string; sdp: RTCSessionDescriptionInit; roomId: string }) => void
  'webrtc-answer': (p: { to: string; sdp: RTCSessionDescriptionInit; roomId: string }) => void
  'webrtc-ice': (p: { to: string; candidate: RTCIceCandidateInit; roomId: string }) => void
  'chat-message': (p: { roomId: string; message: string }) => void
  'chat-typing': (p: { roomId: string; isTyping: boolean }) => void
}

export type Participant = { userId: string; displayName: string; connected: boolean }
export type RoomState = { roomId: string; hasPassword: boolean; participants: Participant[]; startedAt: string | null }

export type ChatMessage = {
  roomId: string
  message: string
  from: { userId: string; displayName: string }
  ts: number
}

export type ChatTyping = {
  roomId: string
  from: { userId: string; displayName: string }
  isTyping: boolean
  ts: number
}

export function createAuthedSocket(token: string) {
  const url = import.meta.env.VITE_SERVER_URL as string

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 3000,
    auth: { token },
  })

  return socket
}
