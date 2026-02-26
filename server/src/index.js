import http from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

import { Server as SocketIOServer } from 'socket.io'

import { config } from './config.js'
import { connectDb } from './db.js'
import { authRouter } from './routes/auth.js'
import { roomsRouter } from './routes/rooms.js'
import { setupSockets } from './sockets/index.js'

async function main() {
  await connectDb()

  const normalizeOrigin = (origin) => String(origin || '').trim().replace(/\/+$/, '')
  const allowedOrigins = new Set((config.clientOrigins || []).map(normalizeOrigin))
  const corsOrigin = (origin, cb) => {
    if (!origin) return cb(null, true)
    const normalized = normalizeOrigin(origin)
    if (allowedOrigins.has(normalized)) return cb(null, origin)
    return cb(new Error(`CORS blocked for origin: ${origin}`))
  }

  const app = express()
  app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false)

  app.use((req, res, next) => {
    if (config.nodeEnv === 'production') {
      const proto = req.headers['x-forwarded-proto']
      if (proto && proto !== 'https') {
        return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`)
      }
    }
    return next()
  })

  app.use(helmet())
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.get('/', (_req, res) => {
    res.type('text/plain').send('DuoMeet server is running. Try /health')
  })

  app.use('/api/auth', authRouter)
  app.use('/api/rooms', roomsRouter)

  const server = http.createServer(app)

  const io = new SocketIOServer(server, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  setupSockets(io)

  server.listen(config.port, () => {
    console.log(`[server] listening on :${config.port}`)
    console.log(`[server] client origin(s): ${(config.clientOrigins || []).join(', ')}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
