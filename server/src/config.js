import dotenv from 'dotenv'

dotenv.config()

const parseOrigins = (raw) => {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\/+$/, ''))
}

const required = (key) => {
  const val = process.env[key]
  if (!val) throw new Error(`Missing env var: ${key}`)
  return val
}

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigins: parseOrigins(process.env.CLIENT_ORIGIN || 'http://localhost:5173'),
  clientOrigin: parseOrigins(process.env.CLIENT_ORIGIN || 'http://localhost:5173')[0] || 'http://localhost:5173',
  mongoUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
}
