import jwt from 'jsonwebtoken'
import { config } from '../config.js'

// Express middleware: verifies Bearer token and attaches req.user
export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null

  if (!token) return res.status(401).json({ error: 'Missing token' })

  try {
    const payload = jwt.verify(token, config.jwtSecret)
    req.user = payload
    return next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}
