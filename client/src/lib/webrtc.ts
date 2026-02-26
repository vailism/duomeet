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
    const [stream] = e.streams
    if (stream) opts.onTrack(stream)
  }

  pc.onconnectionstatechange = () => {
    opts.onConnectionState(pc.connectionState)
  }

  return pc
}

export function addLocalTracks(pc: RTCPeerConnection, stream: MediaStream) {
  const senders = stream.getTracks().map((t) => pc.addTrack(t, stream))
  return senders
}

export async function safeSetRemoteDescription(pc: RTCPeerConnection, sdp: RTCSessionDescriptionInit) {
  const desc = new RTCSessionDescription(sdp)
  await pc.setRemoteDescription(desc)
}
