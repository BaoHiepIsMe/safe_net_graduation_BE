# SafeNet Flutter Integration Contract

This document is the Phase 15 handoff contract. The generated Swagger document
at `/api/docs` is authoritative for field-level request and response schemas.
All REST paths below are relative to `/api/v1`.

## Authentication and envelopes

- Use a Supabase access token as `Authorization: Bearer <token>` for every
  private REST request and as Socket.IO handshake `auth.token`.
- Auth registration/login/refresh are the only APIs that return session tokens.
- Normal success: `{ "success": true, "message": string, "data": ... }`.
- Cursor-list success keeps `data` and `pagination` at the envelope root.
  `pagination` is `{ limit, hasMore, nextCursor }`; pass `nextCursor` back
  unchanged. Lists without a next page return `nextCursor: null`.
- Some bounded list responses have documented root metadata in addition to
  `data` (for example reminder `horizonEndsAt`).
- Error: `{ "success": false, "error": { "code", "message", "details" } }`.
  Branch on the stable `error.code`, never parse a translated message.
- A `204` response has no JSON body. Dates/times are ISO-8601 strings. IDs are
  UUIDs unless Swagger says otherwise. Unknown request fields are rejected.

## REST domain surface

Swagger contains the complete body, query, parameter, success, and error
schemas for these stable groups:

- `/auth`, `/profiles`, and `/health`
- `/families` and `/families/{familyId}/members`
- `/devices` and `/devices/{deviceId}/locations`
- `/locations` and `/families/{familyId}/locations`
- `/families/{familyId}/geofences`
- `/notifications`
- `/sos` and `/sos/contacts`
- `/reminders`
- `/families/{familyId}/cameras`
- `/phone-management`, family phone-management, and device command endpoints
- `/families/{familyId}/conversations` and `/conversations`
- `/conversations/{conversationId}/calls` and `/calls`
- `/daily-status` and family-member daily-status history

Never send actor/owner IDs, status timestamps, recipients, notification source,
or other server-owned fields unless Swagger explicitly defines them.

## Idempotency keys

Generate a UUID once and reuse it for retries of the same logical action:

- device registration: installation identity defined by its request contract;
- location: `clientLocationId`;
- SOS: `clientRequestId`;
- phone usage/commands: the client request ID defined by Swagger;
- message: `clientMessageId`;
- call initiation: `clientRequestId`.

Reusing a key with a different payload produces a conflict. Network retries
must not generate a new key.

## Socket.IO

Connect to the API origin with `auth.token`. The server joins the authenticated
private room `user:{userId}`. Sensitive producers resolve current recipients
server-side and deliver through private user rooms; Flutter must not request a
broad family room as an authorization shortcut.

Server events:

| Event | Safe purpose |
| --- | --- |
| `location.updated` | Authorized location DTO after commit |
| `geofence.entered`, `geofence.exited` | Safe geofence-event DTO |
| `notification.created` | Persisted notification DTO/identifier |
| `sos.created`, `sos.resolved`, `sos.cancelled` | Authorized incident DTO |
| `phone_command.created` | Wake-up metadata for the exact target device |
| `message.created` | Persisted text message DTO |
| `call.created`, `call.accepted`, `call.rejected`, `call.cancelled`, `call.missed`, `call.ended` | Current Call DTO |
| `call.signal` | Ephemeral bounded WebRTC offer/answer/ICE relay |

`call.signal` is the only client-to-server domain event. Follow
[`call-signaling.md`](call-signaling.md). Reauthenticate/reconnect after token
refresh. REST/DB state remains authoritative after disconnects or missed events.

## FCM

FCM is a wake-up transport, not delivery truth. Supported notification types
are `geofence_enter`, `geofence_exit`, `sos_alert`, `reminder`, `message`, and
`call_incoming`. Data contains safe identifiers such as `notificationId` and a
domain record ID; fetch authorized REST detail before rendering sensitive data.
No FCM payload contains precise SOS coordinates, credentials, tokens,
installation IDs, SDP, or ICE. A push does not prove a phone command completed
or a Call was accepted.

## State machines and time semantics

- SOS: `active -> resolved|cancelled`; terminal states do not reopen.
- Calls: `ringing -> accepted|rejected|cancelled|missed`, then
  `accepted -> ended`. Ring timeout defaults to 45 seconds and is server-owned.
- Phone commands are durable requested work; only the exact active target Device
  may acknowledge terminal execution. Transport success is not completion.
- Reminders use an IANA timezone with `once`, `daily`, or `weekly` recurrence.
- Daily Status uses the subject's IANA timezone and the half-open local-day
  window `[midnight, next midnight)`. Reports are immutable non-AI snapshots.

## Privacy and revocation

The database and current server-side relationship state are authoritative.
Pending, rejected, removed, unrelated, archived-family, inactive-device, or
revoked-manager relationships lose access to new protected operations. Passive
location and geofence visibility requires global and per-family sharing. A
manual SOS location snapshot is incident-scoped explicit emergency sharing and
does not change passive sharing settings.

## Explicitly unavailable or unverified

Phone fall AI and camera fall AI are deferred. Automatic fall-to-SOS, camera
streaming/playback, TURN, server media relay, recording, and screen sharing are
not implemented. Actual peer-to-peer voice/video and Android/iOS phone-policy
enforcement require Flutter/device integration and are not verified by this
backend.
