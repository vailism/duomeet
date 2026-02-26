import { customAlphabet } from 'nanoid'
import { z } from 'zod'

// Friendly room codes: easy to read aloud.
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const nanoid = customAlphabet(alphabet, 10)

export function createRoomId() {
  return nanoid()
}

export const roomIdSchema = z
  .string()
  .min(6)
  .max(24)
  .regex(/^[0-9A-Za-z_-]+$/, 'Invalid room id')
