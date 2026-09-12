# SafeNet Phase 13 Call Signaling Contract

Phase 13 implements durable one-to-one Call session state plus an authorized,
ephemeral Socket.IO WebRTC signaling relay. NestJS does not proxy RTP, audio, or
video and does not verify that media packets flowed.

## Socket authentication and transport

Clients authenticate through the existing Socket.IO handshake and automatically
join only their private `user:{userId}` room. Send `call.signal` with exactly one
of these strict payloads:

```json
{
  "callId": "UUID",
  "signalType": "offer",
  "payload": { "type": "offer", "sdp": "bounded SDP" }
}
```

```json
{
  "callId": "UUID",
  "signalType": "answer",
  "payload": { "type": "answer", "sdp": "bounded SDP" }
}
```

```json
{
  "callId": "UUID",
  "signalType": "ice_candidate",
  "payload": {
    "candidate": "bounded candidate",
    "sdpMid": null,
    "sdpMLineIndex": 0,
    "usernameFragment": null
  }
}
```

The backend derives the opposite participant. `targetUserId` is never accepted.
Offers require the current caller, answers require the current callee after the
durable Call has been accepted, and ICE requires a current participant while the
Call is ringing or accepted. Current direct-Conversation, active-Family, and
accepted FamilyMember authorization is rechecked on every signal.

SDP is limited to 16 KiB, ICE candidate text to 2 KiB, and signaling is bounded
to 120 events per socket per rolling technical 60-second window. Unknown fields
and signal types are rejected.

## Privacy and lifecycle boundary

SDP and ICE are relayed only to the opposite participant's private room. They are
not persisted, included in Notifications/FCM/REST Call history, or intentionally
logged. Signaling is rejected after `rejected`, `cancelled`, `missed`, or `ended`,
and after current membership authorization is revoked.

An already established peer-to-peer media path cannot be forcibly terminated by
NestJS. Revocation stops backend signaling; client compliance is required to end
existing peer media.

`accepted` means the callee accepted the invitation. It does not prove media
connectivity. TURN infrastructure, TURN credentials, actual voice/video media,
CallKit, Android ConnectionService, and production NAT traversal are not supplied
or verified by this backend.
