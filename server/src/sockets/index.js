import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { config } from '../config.js'
import { createRoomId, roomIdSchema } from '../utils/room.js'
import { RoomHistory } from '../models/RoomHistory.js'

// In-memory live room state (DB stores history only)
const liveRooms = new Map()

function now() {
  return new Date()
}

function getRoom(roomId) {
  return liveRooms.get(roomId)
}

function publicRoomState(room) {
  return {
    roomId: room.roomId,
    hasPassword: Boolean(room.passwordHash),
    participants: room.participants.map((p) => ({ userId: p.userId, displayName: p.displayName, connected: p.connected })),
    startedAt: room.startedAt,
  }
}

export function setupSockets(io) {
  // Socket auth: expect JWT in handshake.auth.token
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Missing token'))

    try {
      const payload = jwt.verify(token, config.jwtSecret)
      socket.user = payload
      return next()
    } catch {
      return next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    socket.emit('server-ready', { ok: true })

    socket.on('create-room', async ({ password } = {}, ack) => {
      try {
        const roomId = createRoomId()

        const passwordHash = password ? await bcrypt.hash(String(password), 12) : null

        liveRooms.set(roomId, {
          roomId,
          passwordHash,
          createdBy: socket.user.userId,
          participants: [
            {
              userId: socket.user.userId,
              displayName: socket.user.displayName,
              socketId: socket.id,
              connected: true,
            },
          ],
          startedAt: null,
          createdAt: now(),
          lastActiveAt: now(),
        })

        socket.join(roomId)
        ack?.({ ok: true, roomId })
        io.to(roomId).emit('room-state', { room: publicRoomState(getRoom(roomId)) })
      } catch (e) {
        ack?.({ ok: false, error: e?.message || 'Failed to create room' })
      }
    })

    socket.on('join-room', async ({ roomId, password } = {}, ack) => {
      const parsed = roomIdSchema.safeParse(roomId)
      if (!parsed.success) return ack?.({ ok: false, error: 'Invalid room id' })

      const room = getRoom(roomId)
      if (!room) return ack?.({ ok: false, error: 'Room not found' })

      // If user is reconnecting, replace their socketId.
      const existingIdx = room.participants.findIndex((p) => p.userId === socket.user.userId)
      if (existingIdx !== -1) {
        room.participants[existingIdx] = {
          ...room.participants[existingIdx],
          socketId: socket.id,
          connected: true,
        }
        socket.join(roomId)
        room.lastActiveAt = now()
        ack?.({ ok: true, room: publicRoomState(room), reconnected: true })
        io.to(roomId).emit('room-state', { room: publicRoomState(room) })
        io.to(roomId).emit('renegotiate', { reason: 'peer-reconnected' })

        // Kick off a fresh negotiation if both participants are connected.
        const connected = room.participants.filter((p) => p.connected)
        if (connected.length === 2) {
          const first = room.participants[0]
          const other = connected.find((p) => p.userId !== first.userId) || connected[1]
          if (first?.socketId && other?.socketId && first.socketId !== other.socketId) {
            io.to(first.socketId).emit('ready-for-offer', { roomId, to: other.socketId })
          }
        }
        return
      }

      if (room.passwordHash) {
        const ok = await bcrypt.compare(String(password || ''), room.passwordHash)
        if (!ok) return ack?.({ ok: false, error: 'Wrong room password' })
      }

      const connectedCount = room.participants.filter((p) => p.connected).length
      if (connectedCount >= 2) return ack?.({ ok: false, error: 'Room is full (2 max)' })

      room.participants.push({
        userId: socket.user.userId,
        displayName: socket.user.displayName,
        socketId: socket.id,
        connected: true,
      })

      socket.join(roomId)
      room.lastActiveAt = now()

      if (!room.startedAt && room.participants.filter((p) => p.connected).length === 2) {
        room.startedAt = now()
      }

      ack?.({ ok: true, room: publicRoomState(room), reconnected: false })
      io.to(roomId).emit('room-state', { room: publicRoomState(room) })

      // Tell the first participant to start offer/answer.
      const first = room.participants[0]
      if (first?.socketId && first.socketId !== socket.id) {
        io.to(first.socketId).emit('ready-for-offer', { roomId, to: socket.id })
      }
    })

    socket.on('leave-room', async ({ roomId } = {}, ack) => {
      await handleLeave({ io, socket, roomId, reason: 'left' })
      ack?.({ ok: true })
    })

    socket.on('end-call', async ({ roomId } = {}, ack) => {
      await handleEndCall({ io, socket, roomId, reason: 'ended' })
      ack?.({ ok: true })
    })

    // WebRTC signaling (forward only)
    socket.on('webrtc-offer', ({ to, sdp, roomId }) => {
      if (!to || !sdp || !roomId) return
      io.to(to).emit('webrtc-offer', { from: socket.id, sdp, roomId })
    })

    socket.on('webrtc-answer', ({ to, sdp, roomId }) => {
      if (!to || !sdp || !roomId) return
      io.to(to).emit('webrtc-answer', { from: socket.id, sdp, roomId })
    })

    socket.on('webrtc-ice', ({ to, candidate, roomId }) => {
      if (!to || !candidate || !roomId) return
      io.to(to).emit('webrtc-ice', { from: socket.id, candidate, roomId })
    })

    // Chat
    socket.on('chat-message', ({ roomId, message }) => {
      if (!roomId || typeof message !== 'string' || !message.trim()) return
      io.to(roomId).emit('chat-message', {
        roomId,
        message: message.slice(0, 2000),
        from: { userId: socket.user.userId, displayName: socket.user.displayName },
        ts: Date.now(),
      })
    })

    socket.on('chat-typing', ({ roomId, isTyping }) => {
      if (!roomId) return
      socket.to(roomId).emit('chat-typing', {
        roomId,
        from: { userId: socket.user.userId, displayName: socket.user.displayName },
        isTyping: Boolean(isTyping),
        ts: Date.now(),
      })
    })

    socket.on('disconnect', async () => {
      // Mark disconnected in any room this user is part of
      for (const room of liveRooms.values()) {
        const idx = room.participants.findIndex((p) => p.socketId === socket.id)
        if (idx !== -1) {
          room.participants[idx].connected = false
          room.lastActiveAt = now()
          io.to(room.roomId).emit('room-state', { room: publicRoomState(room) })
          socket.to(room.roomId).emit('peer-left', { roomId: room.roomId, userId: room.participants[idx].userId })

          // If nobody left connected, finalize + delete.
          const anyConnected = room.participants.some((p) => p.connected)
          if (!anyConnected) {
            await finalizeRoomHistory(room)
            liveRooms.delete(room.roomId)
          }
        }
      }
    })
  })
}

async function finalizeRoomHistory(room) {
  // Persist a history record only if the room ever had 2 participants.
  if (!room.startedAt) return

  const endedAt = now()
  const durationSec = Math.max(0, Math.round((endedAt.getTime() - room.startedAt.getTime()) / 1000))

  try {
    await RoomHistory.create({
      roomId: room.roomId,
      createdBy: room.createdBy,
      participants: room.participants.map((p) => ({ userId: p.userId, displayName: p.displayName })),
      startedAt: room.startedAt,
      endedAt,
      durationSec,
    })
  } catch {
    // Ignore history failures (should not break calls)
  }
}

async function handleLeave({ io, socket, roomId, reason }) {
  if (!roomId) return
  const room = getRoom(roomId)
  if (!room) return

  const idx = room.participants.findIndex((p) => p.socketId === socket.id)
  if (idx === -1) return

  room.participants[idx].connected = false
  room.lastActiveAt = now()

  socket.leave(roomId)
  socket.to(roomId).emit('peer-left', { roomId, userId: room.participants[idx].userId, reason })
  io.to(roomId).emit('room-state', { room: publicRoomState(room) })

  const anyConnected = room.participants.some((p) => p.connected)
  if (!anyConnected) {
    await finalizeRoomHistory(room)
    liveRooms.delete(roomId)
  }
}

async function handleEndCall({ io, socket, roomId, reason }) {
  if (!roomId) return
  const room = getRoom(roomId)
  if (!room) return

  io.to(roomId).emit('call-ended', { roomId, reason, by: { userId: socket.user.userId, displayName: socket.user.displayName } })

  for (const p of room.participants) {
    io.sockets.sockets.get(p.socketId)?.leave(roomId)
  }

  await finalizeRoomHistory(room)
  liveRooms.delete(roomId)
}
