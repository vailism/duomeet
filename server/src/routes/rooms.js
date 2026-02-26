import express from 'express'
import mongoose from 'mongoose'
import { RoomHistory } from '../models/RoomHistory.js'
import { requireAuth } from '../middleware/auth.js'

export const roomsRouter = express.Router()

roomsRouter.get('/history', requireAuth, async (req, res) => {
  const userId = req.user.userId

  const oid = new mongoose.Types.ObjectId(userId)

  const items = await RoomHistory.find({ 'participants.userId': oid })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()

  return res.json({ items })
})
