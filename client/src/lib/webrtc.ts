// WebRTC helper utilities for 1-to-1 calls.
//
// WebRTC basics (simple):
// - Each browser creates an RTCPeerConnection.
// - They exchange an SDP "offer" and "answer" (describes media + codecs).
// - They also exchange ICE candidates (possible network routes).
// - We use Socket.io only to send these messages (signaling).

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
}

export function createPeerConnection(opts: {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void
  onTrack: (stream: MediaStream) => void
  onConnectionState: (state: RTCPeerConnectionState) => void
}) {
  const pc = new RTCPeerConnection(RTC_CONFIG)

  pc.onicecandidate = (e) => {
    if (e.candidate) opts.onIceCandidate(e.candidate.toJSON())
  }

  pc.ontrack = (e) => {
    // In 1-to-1, we expect a single remote stream.
    const [stream] = e.streams
    if (stream) opts.onTrack(stream)
  }

  pc.onconnectionstatechange = () => {
    opts.onConnectionState(pc.connectionState)
  }

  return pc
}

export function addLocalTracks(pc: RTCPeerConnection, stream: MediaStream) {
  // Add all tracks (audio + video). The returned senders let us replace tracks later.
  const senders = stream.getTracks().map((t) => pc.addTrack(t, stream))
  return senders
}

export async function safeSetRemoteDescription(pc: RTCPeerConnection, sdp: RTCSessionDescriptionInit) {
  // Some browsers can throw if descriptions are applied out of order.
  // For a simple 1-to-1 app, we still guard with a small helper.
  const desc = new RTCSessionDescription(sdp)
  await pc.setRemoteDescription(desc)
}
