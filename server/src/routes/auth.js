import express from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { z } from 'zod'

import { User } from '../models/User.js'
import { config } from '../config.js'
import { requireAuth } from '../middleware/auth.js'

export const authRouter = express.Router()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(60),
})

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { email, password, displayName } = parsed.data

  const existing = await User.findOne({ email }).lean()
  if (existing) return res.status(409).json({ error: 'Email already registered' })

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await User.create({ email, displayName, passwordHash })

  const token = jwt.sign(
    { userId: String(user._id), email: user.email, displayName: user.displayName },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )

  return res.json({ token, user: { userId: String(user._id), email: user.email, displayName: user.displayName } })
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const { email, password } = parsed.data

  const user = await User.findOne({ email })
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })

  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

  const token = jwt.sign(
    { userId: String(user._id), email: user.email, displayName: user.displayName },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )

  return res.json({ token, user: { userId: String(user._id), email: user.email, displayName: user.displayName } })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  return res.json({ user: req.user })
})
