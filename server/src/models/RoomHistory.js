import mongoose from 'mongoose'

const participantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    displayName: { type: String, required: true },
  },
  { _id: false },
)

const roomHistorySchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    participants: { type: [participantSchema], default: [] },
    startedAt: { type: Date },
    endedAt: { type: Date },
    durationSec: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const RoomHistory = mongoose.model('RoomHistory', roomHistorySchema)
