# Codex Master Prompt - Build Complete SafeNet NestJS Backend

You are implementing the complete backend for the SafeNet graduation project.

## Mandatory first instructions

1. Read `AGENTS.md` in the repository root completely before changing code. It is the binding engineering contract.
2. Inspect the entire existing NestJS repository before creating architecture:
   - `package.json`
   - `src/main.ts`
   - `src/app.module.ts`
   - all existing modules/controllers/services/providers/guards/filters/interceptors/pipes/decorators
   - Supabase configuration/client/provider
   - database migrations/schema files
   - test setup and existing tests
   - `.env.example`
   - Swagger/OpenAPI setup
   - existing realtime Gateway code
   - existing Firebase/FCM integration
   - existing documentation
3. Existing working code and already-applied migrations are the source of truth. Evolve the repository; do not replace it with a new backend base.

Do not stop after auditing or planning. Continue implementation phase-by-phase unless a true external dependency makes a specific capability impossible.

---

## Product context

SafeNet is a Flutter family-safety application with these backend capabilities:

- Supabase authentication and profiles.
- Families and family membership/roles.
- Member invitations/linking by approved email/phone flow.
- Devices and FCM token registration.
- Current location and location history.
- Family map.
- Safe zones/geofences and enter/exit events.
- Camera metadata.
- Fall-detection event ingestion from phone or camera.
- Fall confirmation, false-alarm, and resolution workflow.
- Reminders with recurrence, multi-member targets, and occurrence logs.
- Persistent notifications and FCM push.
- SOS contacts and SOS events.
- Child phone usage, rules, and commands.
- Daily status reports.
- User settings and biometric preference settings.
- Direct/group conversations and messages.
- Per-user message read state.
- Realtime delivery through the approved NestJS Socket.IO Gateway.
- Call session/log/signaling metadata and incoming-call notification contract.
- Upload/media metadata required by those features.
- Audit/ops support for safety-critical actions.

The most important product feature is reliable fall-detection alert handling.

Safety-critical workflows must favor correctness, authorization, persistence, and duplicate safety over shortcuts.

---

## Critical architecture decisions

This backend is **NestJS**, not Express architecture and not Next.js.

Use NestJS patterns:

- modules;
- controllers;
- services;
- dependency injection;
- guards;
- decorators;
- pipes;
- exception filters;
- interceptors;
- WebSocket Gateways;
- `@nestjs/swagger`;
- `@nestjs/testing`.

Do not create an Express-style `routes/controllers/middleware` parallel application. NestJS may use Express internally, but application architecture must remain NestJS.

SafeNet uses Supabase Auth.

Do NOT create the obsolete custom `users` table with `password_hash`.

Use:

- `auth.users` for authentication identity/session;
- `public.profiles` for application profile data.

Older schema/spec references to `users(id)` must be reconciled to the current profile/Supabase Auth architecture by forward migrations after inspecting existing migrations.

Do not introduce Next.js, standalone Express architecture, Drizzle, Sequelize, TypeORM, MongoDB, a custom JWT issuer, Redis, Kafka, RabbitMQ, BullMQ, Twilio, Agora, an external AI/LLM provider, or another realtime framework unless the repository/AGENTS explicitly approves it.

Prisma ORM with `@prisma/adapter-pg` is the approved primary application-data layer. Use this architecture:

```text
Controller
â†’ Service
â†’ Repository / Data Access
â†’ PrismaService
â†’ Supabase PostgreSQL
```

Supabase JS remains responsible for Supabase Auth and genuinely required admin-auth operations. Do not use `supabase.from(...)` as normal application-table data access, replace Supabase Auth, or make Prisma own `auth.users`.

---

## API contract is non-negotiable

Use exactly these HTTP meanings:

- `200 OK` - successful response with body.
- `201 Created` - resource created.
- `204 No Content` - success with no body.
- `400 Bad Request` - malformed request/request validation failure.
- `401 Unauthorized` - missing/invalid/expired authentication.
- `403 Forbidden` - authenticated but insufficient permission.
- `404 Not Found` - resource not found or intentionally hidden by access policy.
- `409 Conflict` - duplicate/conflict/idempotency conflict.
- `422 Unprocessable Content` - structurally valid request but invalid domain state transition/business rule when appropriate.
- `429 Too Many Requests` - rate limit.
- `500 Internal Server Error` - unexpected server failure.

A `204` response MUST NOT contain JSON.

Success response:

```json
{
  "success": true,
  "message": "Thành công",
  "data": {}
}
```

Page list response:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

Cursor list response for messages/location history/notifications/high-churn streams:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "limit": 30,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error response:

```json
{
  "success": false,
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "Không tìm thấy người dùng",
    "details": null
  }
}
```

Flutter must branch on `error.code`, not message text.

Implement a centralized NestJS exception/response strategy. Do not manually invent a different response shape in each controller.

---

## Validation rules

Use Zod for untrusted data.

Create/reuse a NestJS Zod validation pipe/helper so validation is consistent.

Validate:

- bodies;
- route params;
- query params;
- relevant headers;
- uploads;
- phone/device event payloads;
- fall payloads;
- external/webhook responses used by business logic.

Do not rely on Flutter validation.

Use strict object schemas unless extra fields are intentionally allowed.

---

## Authentication rules

Protected API flow:

```text
Flutter
→ Authorization: Bearer <Supabase access token>
→ NestJS AuthGuard
→ verify token through approved Supabase method
→ authenticated user context
→ authorization
→ service
→ repository/database
```

Reuse/create a `CurrentUser` decorator or equivalent.

Never trust body/query actor IDs when the actor is the current authenticated user.

Never expose password hashes, access/refresh tokens, raw auth metadata, service-role keys, Firebase private keys, or internal security fields.

---

## Authorization rules

Every private resource must enforce authorization, not only authentication.

Check as applicable:

- family membership;
- family role (`manager`, `adult`, `child`, `elder`);
- ownership;
- membership status;
- conversation membership;
- target-member relationship;
- device/user/member binding;
- account status;
- resource family ownership.

UUID knowledge never grants access.

Do not trust client-supplied actor fields such as:

```text
userId
ownerUserId
senderId
createdBy
updatedBy
resolvedBy
handledBy
```

Derive them from authenticated identity when appropriate.

---

## Database/model requirements

Do not rebuild the database from scratch.

Inspect and introspect the existing database first. Baseline it with Prisma's existing-database workflow, preserve required custom PostgreSQL SQL, then evolve application schema through `prisma/migrations/` as the single future migration owner.

Do not execute baseline SQL against the populated database, reset it, or run `prisma migrate dev` before the existing schema is safely baselined. Preserve RLS, policies, Auth signup triggers, functions, grants/revokes, and other PostgreSQL features Prisma cannot express as custom Prisma migrations.

The final logical model must support the SafeNet specification, including:

- `profiles`
- `user_settings`
- `biometric_settings`
- `families`
- `family_members`
- `devices`
- `locations`
- `current_locations`
- `geofences`
- `geofence_members`
- `geofence_events`
- `cameras`
- `fall_events`
- `reminders`
- `reminder_targets`
- `reminder_logs`
- `notifications`
- `sos_contacts`
- `sos_events`
- `phone_usage_logs`
- `phone_rules`
- `phone_commands`
- `daily_status_reports`
- `conversations`
- `conversation_members`
- `messages`
- per-user message read state such as `message_receipts` or an approved conversation read cursor
- `call_logs`
- narrow supporting tables for audit/idempotency/reliable delivery when required

When reconciling the old database draft, fix at least these issues:

1. No custom `users.password_hash`; use Supabase Auth + `profiles`.
2. Use timezone-aware timestamps consistently for real-world events.
3. Add appropriate FK/UNIQUE/NOT NULL/CHECK/default constraints.
4. Keep family owner and manager membership logically consistent.
5. Prevent duplicate logical memberships/invite acceptance.
6. Keep `locations` history and `current_locations` projection consistent.
7. Ensure geofence target members belong to the same family.
8. Prevent noisy duplicate geofence enter/exit events.
9. Validate fall source type against device/camera and member/family binding.
10. Treat camera stream data as sensitive.
11. Prevent duplicate reminder occurrences.
12. Group chat read state must be per user, not only `messages.read_at`.
13. Prevent duplicate logical direct conversations.
14. Validate sender/conversation membership.
15. Validate phone-command target device/member/family authorization.
16. Enforce one daily report per member/date.
17. Add indexes for authorization joins, chronological streams, notifications, messages, location history, SOS, fall events, geofence events, phone usage, reminder logs, and other high-frequency queries.

---

## Transaction and idempotency rules

Use transactions for multi-write business operations that represent one logical operation.

At minimum inspect/implement transaction boundaries for:

- family creation + initial manager membership;
- invite acceptance/state transition;
- location-history append + current-location update when consistency is required;
- fall event + persistent notifications/outbox/audit records;
- SOS event + persistent notifications/outbox/audit records;
- critical multi-record state transitions.

Safety-critical rule:

```text
validate
→ authenticate
→ authorize
→ idempotency
→ transaction
→ commit
→ realtime / FCM
```

Database is the source of truth.

Support idempotency for duplicate-sensitive operations such as:

- SOS trigger;
- fall-event ingestion;
- phone command creation;
- invitation acceptance;
- external callbacks where retries are possible.

If the same idempotency key is reused with a conflicting payload, return `409` with a stable error code.

---

## Realtime and push rules

Use the existing NestJS WebSocket Gateway + Socket.IO architecture if present. If missing and realtime features are in scope, implement the approved NestJS Gateway infrastructure once and reuse it.

Authenticate WebSocket handshakes.

Authorize every private room subscription server-side.

Room concepts may include:

```text
user:{userId}
family:{familyId}
member:{memberId}
chat:{conversationId}
```

Do not allow clients to subscribe to arbitrary user/family/chat rooms.

Critical rule:

```text
DATABASE = SOURCE OF TRUTH
REALTIME = DELIVERY
FCM = DELIVERY
```

Persist/commit before emitting.

For safety-critical delivery, inspect whether a transactional outbox already exists. Reuse it if present. If reliable retries are required and no broker is approved, a PostgreSQL transactional outbox is acceptable under `AGENTS.md`.

Do not claim exactly-once delivery. Make event handling duplicate-safe.

Flutter must be able to recover authoritative state from REST/sync endpoints after reconnect/restart.

---

## Safety-critical fall workflow

The backend does not train the fall model unless a separate explicit AI task says so.

For an incoming fall result:

```text
source/device authentication
→ Zod validation
→ member/family/device/camera binding check
→ idempotency/deduplication
→ DB transaction
   → create fall event
   → create persistent notifications
   → create audit/outbox records when required
→ commit
→ realtime
→ FCM
```

Support valid status transitions such as:

```text
detected
confirmed
false_alarm
resolved
```

Do not invent confidence thresholds.

Do not claim AI inference succeeded merely because the API accepted an event.

---

## Safety-critical SOS workflow

Recommended flow:

```text
request
→ authentication
→ authorization
→ idempotency
→ transaction
   → create SOS event
   → snapshot location if available/allowed
   → create persistent notifications
   → create audit/outbox records when required
→ commit
→ realtime
→ FCM
→ external call integration only if a real provider/device capability exists
```

Support explicit states such as:

```text
triggered
calling
handled
cancelled
```

A failed realtime/FCM delivery must not roll back or delete a committed SOS event.

---

## NestJS code-quality rules

- Controllers stay thin.
- Services own business logic.
- Repositories/data-access providers own database queries.
- Guards/decorators handle reusable auth/authz context.
- Global exception filters enforce error contract.
- Interceptors/middleware may handle response formatting, logging, and request IDs where appropriate.
- Use dependency injection; do not manually instantiate providers.
- Avoid circular module dependencies; use clear domain boundaries.
- Avoid unrelated refactors.
- Do not create placeholder services/controllers that only return fake success.
- Do not leave avoidable TODOs in a phase marked complete.

---

## Required implementation phases

Implement in dependency order. Finish each phase, run verification, fix implementation-caused failures, document status, then continue automatically.

### Phase 0 - Repository audit and NestJS foundation

- Read all source and migrations.
- Create/update `docs/backend-implementation-plan.md` with each domain marked: `existing`, `partial`, `missing`, `needs migration`, or `external dependency`.
- Verify `main.ts`, global prefix, global pipes, exception filters, interceptors, CORS, security settings, body-size limits.
- Verify/create standard response helpers/interceptor.
- Verify/create application error abstraction and global exception filter.
- Verify/create request ID and structured logging without sensitive fields.
- Verify/create reusable Zod validation pipe.
- Verify Supabase Auth/admin-auth providers and the reusable Prisma database module.
- Verify authentication guard/current-user decorator.
- Verify environment validation and `.env.example`.
- Verify Swagger setup.
- Verify Jest/E2E setup.
- Verify/create `GET /api/health`.

Do not stop after the audit.

### Phase 1 - Auth, profiles, settings

Implement/complete:

- Supabase signup/register integration consistent with existing architecture;
- login;
- refresh/session endpoint only if the backend contract requires it;
- logout/sign-out behavior as appropriate;
- authenticated current-user endpoint;
- profile get/update;
- user settings get/update;
- biometric preference get/update;
- forgot/reset password contract required by Flutter UI.

Do not duplicate profile creation if a database trigger already creates the profile.

### Phase 2 - Families and family authorization

Implement/complete:

- family create/read/update/archive/delete behavior according to approved data lifecycle;
- initial manager membership;
- family member list/detail;
- invite/link by approved email or phone lookup flow;
- relation label;
- pending/accepted/rejected/removed membership states;
- accept/reject/remove operations;
- ownership/manager authorization;
- reusable family access policies/guards/helpers;
- pagination where lists can grow.

### Phase 3 - Devices

Implement/complete:

- register/update device;
- FCM token registration/rotation;
- active state;
- last-seen/battery metadata;
- authorized device/member association;
- revoke/deactivate behavior.

Never expose another user's FCM token.

### Phase 4 - Locations and family map

Implement/complete:

- trusted location update;
- `current_locations` upsert/projection;
- location history;
- family current-location map endpoint;
- member location detail;
- sharing-state enforcement;
- cursor pagination/date-range limits;
- indexes;
- transaction/consistency rules.

Do not log precise coordinates in generic logs.

### Phase 5 - Geofences

Implement/complete:

- geofence CRUD;
- member assignment;
- enter/exit notification preferences;
- point-in-geofence evaluation or the approved event-ingestion approach;
- duplicate/noisy event prevention;
- persistent geofence events;
- notifications/realtime/FCM after persistence.

### Phase 6 - Notifications + FCM + realtime foundation

Implement/complete:

- persistent notification list;
- unread count;
- mark one read;
- mark all read;
- cursor pagination;
- FCM delivery service;
- safe device-token targeting;
- WebSocket Gateway authentication;
- room authorization;
- personal/family/member room contracts as required;
- reliable delivery/outbox integration if required by current repository design.

### Phase 7 - SOS

Implement/complete:

- SOS contact CRUD;
- priority/order rules;
- SOS trigger with idempotency;
- location snapshot when available;
- state transitions;
- handler metadata;
- persistent notifications;
- realtime + FCM after commit;
- audit records;
- tests for duplicate requests and delivery failure behavior.

### Phase 8 - Fall detection events — DEFERRED UNTIL AI MODELS ARE READY
## Deferred AI Phase

Phase 8 must NOT block later non-AI backend phases.

If the phone-sensor or camera fall-detection model is not ready, mark Phase 8 as:

DEFERRED — WAITING FOR AI MODEL

and continue with Phase 9 and later non-AI phases when requested.

Do not create mock AI inference simply to complete the phase.

Camera CRUD/device management may be implemented independently from camera AI.

Device/location functionality may be implemented independently from phone-sensor AI.

Implement/complete:

- phone fall-event ingestion;
- camera fall-event ingestion contract;
- source/device/camera/member/family validation;
- sensor/AI/evidence metadata persistence;
- idempotency/deduplication;
- `detected → confirmed/false_alarm/resolved` state rules;
- persistent notification fanout;
- realtime + FCM after commit;
- audit records;
- E2E tests for safety-critical behavior.

Do not train/invent the AI model in this backend phase.

### Phase 9 - Reminders

Implement/complete:

- reminder CRUD;
- multi-member targets;
- recurrence schema/rule validation;
- reminder occurrence/log model;
- duplicate occurrence prevention;
- pending/completed/missed/skipped updates;
- upcoming/history queries;
- notification contract for due reminders.

Do not add a queue unless explicitly approved. If scheduled background execution is required and no approved scheduler exists, use an existing NestJS scheduling dependency if already present or document the required dependency before adding new infrastructure.

### Phase 10 - Cameras

Implement/complete:

- camera metadata CRUD;
- family authorization;
- secure handling of stream connection metadata;
- fall-detection enable/disable metadata;
- status/last online metadata;
- camera-related event/notification queries where required.

Do not expose raw credentials or pretend the backend owns camera streaming if it does not.

### Phase 11 - Phone management

Implement/complete:

- usage log ingestion/listing;
- phone-rule CRUD;
- target-child authorization;
- daily limits/bedtime validation;
- phone commands (`lock`, `ring`, `warning`) persistence;
- idempotent command creation;
- state transitions `pending/sent/completed/failed`;
- device acknowledgement endpoint/contract;
- realtime/FCM command delivery only after persistence.

Do not mark a command completed until the client/device confirms execution.

### Phase 12 - Conversations and messages

Implement/complete:

- direct conversations;
- group conversations;
- member management where allowed;
- duplicate direct-conversation prevention;
- conversation list optimized for mobile inbox;
- message persistence;
- text/image/location/system message validation as supported;
- cursor-paginated history;
- per-user read state;
- realtime message delivery after persistence;
- conversation membership authorization for every operation.

### Phase 13 - Calls

Implement/complete internally supportable backend behavior:

- call session/log creation;
- caller/receiver authorization;
- incoming-call signaling/notification contract;
- audio/video type metadata;
- state transitions such as missed/completed/rejected/cancelled;
- duration/end metadata;
- realtime/FCM signaling where appropriate.

If real audio/video transport needs an external provider or native WebRTC signaling that does not exist, do not invent it. Document the external dependency clearly.

### Phase 14 - Daily status reports

Implement/complete:

- one report per member/date;
- authorized list/detail queries;
- summaries based on actual stored location/reminder/phone/fall data;
- fall-risk/activity/AI fields only when a real approved computation supplies them;
- no fabricated AI result.

### Phase 15 - Upload/media support

Implement only the storage/media operations required by existing features.

Validate:

- ownership;
- target usage;
- MIME type;
- extension when applicable;
- size;
- count;
- safe/randomized storage path.

Do not expose internal/private storage paths or secrets.

### Phase 16 - Hardening, docs, and production verification

Complete:

- rate limiting for sensitive flows;
- request/body/upload limits;
- CORS allowlist configuration;
- SSRF protection for any URL-fetching feature;
- structured logging and request IDs;
- audit logging for critical actions;
- health/readiness as required;
- Swagger coverage;
- README;
- `.env.example`;
- migration documentation;
- backup/restore/deployment notes where appropriate;
- N+1/query review;
- secret/logging review;
- authorization review.

Run the repository's complete verification suite.

---

## Required verification after each phase

Run all applicable repository commands, typically including:

```text
npm run lint
npm run typecheck     (or equivalent if defined)
npm test
npm run test:e2e      (for affected integration/API behavior)
npm run build
```

If the repository uses different command names, inspect `package.json` and use the actual scripts.

Fix failures caused by your implementation before moving on.

Do not hide failing tests by deleting/skipping them unless a test is provably obsolete and the change is documented.

---

## Required implementation log

Maintain:

```text
docs/backend-implementation-log.md
```

After each phase record:

- date/phase;
- modules completed;
- routes added/changed;
- migrations added;
- important constraints/indexes;
- authorization rules;
- realtime/FCM behavior;
- tests added;
- verification results;
- external dependencies remaining;
- known limitations that are genuinely outside the backend.

Do not mark incomplete or mocked functionality as complete.

---

## Final completion criteria

Do not claim "backend complete" unless all internally implementable phases are done and the repository passes required verification.

Final report must include:

- NestJS modules completed;
- API route groups completed;
- database migrations created;
- constraints/indexes added;
- authentication model;
- authorization model;
- transaction boundaries;
- idempotency mechanisms;
- realtime/FCM reliability behavior;
- fall-detection backend workflow;
- SOS workflow;
- tests and results;
- lint/type-check/build results;
- Swagger/API documentation status;
- differences corrected from the old database draft;
- external dependencies that genuinely remain.

Do not stop at scaffolding.

Do not create fake success endpoints.

Do not silently switch framework or architecture.

The backend must remain NestJS throughout the implementation.
