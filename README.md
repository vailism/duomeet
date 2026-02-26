# DuoMeet (Private Couple Video App)

A private 1-to-1 WebRTC video calling app (Google Meet vibes, but only for two).

## Features
- 1-to-1 HD video calling (WebRTC)
- Mute / unmute, camera on / off, screen share
- Real-time text chat + typing indicator
- Room create + join with code, optional password
- Only two users allowed per room
- Connection status + auto-reconnect
- Call timer
- Dark mode + **Arya Mode** (romantic gradient + subtle hearts)
- Small floating heart burst when call connects
- Optional background music toggle (Web Audio; no external assets)

## Project structure
- `client/` React + Vite frontend
- `server/` Node.js + Express + Socket.io backend (signaling + REST APIs)

## Local setup
### 1) Prereqs
- Node.js 18+ recommended
- MongoDB (local or Atlas)

### 2) Configure env
- Copy [server/.env.example](server/.env.example) to `server/.env` and fill values
- Copy [client/.env.example](client/.env.example) to `client/.env` and fill values

Minimum required values:
- `server/.env`: `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`
- `client/.env`: `VITE_SERVER_URL`

### 3) Install + run
From repo root:
```bash
npm install
npm run dev
```
- Client: http://localhost:5173
- Server: http://localhost:8080

> Note: `getUserMedia()` requires **HTTPS** in production, but works on `http://localhost` for local dev.

### 4) Test a call (step-by-step)
1. Open http://localhost:5173 in **two** browser windows (or two devices)
2. Register/login as two different users
3. In window A: set optional room password → click **Create room**
4. Copy the room code, send to your partner
5. In window B: paste room code (and password if set) → click **Join room**
6. The call should connect and show a small heart burst

If you see "Room is full (2 max)", a third participant tried joining (this is expected).

## Deployment overview (Render + Vercel)
- Deploy the backend (`server/`) to Render as a Web Service
- Deploy the frontend (`client/`) to Vercel
- Set `CLIENT_ORIGIN` on the server to your Vercel URL
- Set `VITE_SERVER_URL` on the client to your Render URL

More details are in the bottom of this README.

---

## How WebRTC works (simple)
WebRTC creates a direct peer-to-peer connection between two browsers.
- Each browser creates an `RTCPeerConnection`.
- They exchange **session descriptions** (offer/answer) and **ICE candidates** (network routes).
- That exchange needs a **signaling server** (Socket.io here) to pass messages.
- Once both sides have enough info, the media flows browser-to-browser (or best possible route), using STUN to discover public-facing network addresses.

Important practical note:
- This project uses **STUN only** (Google public STUN). Some corporate/mobile networks require a TURN relay to connect reliably. If you need “works everywhere”, add a TURN server later.

---

## Environment variables
See:
- [server/.env.example](server/.env.example)
- [client/.env.example](client/.env.example)

---

## Production HTTPS note
In production, terminate TLS at the platform (Render/Vercel) and run the Node server behind their proxy. The server includes a small middleware to redirect HTTP->HTTPS when `NODE_ENV=production`.

---

## Deployment steps (detailed)
### Backend (Render)
Prereq: use MongoDB Atlas (or any externally reachable MongoDB). Render doesn’t provide managed MongoDB.

Option A (fastest): Use the included blueprint file [render.yaml](render.yaml).
1. Push this repo to GitHub
2. In Render: **New** → **Blueprint** → select your repo
3. Set env vars for `duomeet-server`:
	- `CLIENT_ORIGIN` = `https://<your-vercel-app>.vercel.app`
	- `MONGODB_URI` = your Atlas connection string
	- `JWT_SECRET` = long random string

Option B: Create a Web Service manually.
1. New Web Service from your repo
2. Root directory: `server`
3. Build command: `npm install`
4. Start command: `npm start`
5. Add env vars from [server/.env.example](server/.env.example)
6. Render will provide `PORT` automatically

### Frontend (Vercel)
1. Import project
2. Root directory: `client`
3. Build command: `npm run build`
4. Output: `dist`
5. Add env vars from [client/.env.example](client/.env.example)
	- `VITE_SERVER_URL` = `https://<your-render-service>.onrender.com`

After deploy:
- Share your Vercel URL with your girlfriend (that’s the link she opens).
- You both login, create/join a room, and the call runs over HTTPS.

Note: This app uses STUN-only. If one of you is on a restrictive network and the call won’t connect, the next step is adding a TURN server.

