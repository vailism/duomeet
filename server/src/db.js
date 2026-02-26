import mongoose from 'mongoose'
import { config } from './config.js'

export async function connectDb() {
  mongoose.set('strictQuery', true)
  await mongoose.connect(config.mongoUri)
  // eslint-disable-next-line no-console
  console.log('[db] connected')
}
