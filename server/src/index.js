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

  const app = express()
  // `express-rate-limit` rejects `trust proxy: true` because it allows IP spoofing.
  // On platforms like Render, requests come through a single reverse proxy.
  app.set('trust proxy', config.nodeEnv === 'production' ? 1 : false)

  // Force HTTPS in production behind proxy (Render, etc.)
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
      origin: config.clientOrigin,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  // Basic abuse protection (tune as needed)
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
      origin: config.clientOrigin,
      methods: ['GET', 'POST'],
    },
  })

  setupSockets(io)

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on :${config.port}`)
    // eslint-disable-next-line no-console
    console.log(`[server] client origin: ${config.clientOrigin}`)
  })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
