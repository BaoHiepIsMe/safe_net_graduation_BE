# AGENTS.md

## 1. Project Identity

SafeNet is a Flutter mobile application for family safety, monitoring, emergency response, and family coordination.

Primary users:

- Family managers/caregivers.
- Adult family members.
- Elderly family members who may need monitoring or emergency assistance.
- Children whose safety, location, reminders, and device usage may be managed by authorized family members.

Core product capabilities:

- AI fall-detection event ingestion from phone sensors and, when available, family cameras.
- Reliable fall alert workflow and family notification.
- Family/group membership and roles.
- Current location, location history, family map, and safe-zone/geofence alerts.
- Reminders and reminder completion tracking.
- SOS contacts and SOS events.
- Persistent notifications and push notifications.
- Device registration and child-phone management.
- Chat and call metadata/signaling interfaces when required.
- Daily status reports, settings, and biometric preference data.

The client is Flutter. The backend must expose stable mobile-friendly APIs and must not assume a browser-only frontend.

This is a graduation-project backend, but it must still follow production-grade boundaries for authentication, authorization, data integrity, migrations, testing, error handling, observability, idempotency, and safety-critical workflows.

---

## 2. Source of Truth and Conflict Resolution

Use this precedence order when instructions conflict:

1. Existing working repository code and already-applied database migrations.
2. This `AGENTS.md`.
3. Current repository API/database documentation.
4. The feature specification for the current task.
5. Older design notes or drafts.

Important SafeNet authentication decision:

- Supabase Auth is the authentication source of truth.
- `auth.users` owns authentication identity, passwords, sessions, and provider metadata.
- App profile data belongs in `public.profiles`.
- Do NOT recreate the obsolete custom `public.users` table with `password_hash`.
- Older schema references to `users(id)` must be reconciled to the current Supabase Auth/profile model through forward migrations.

Never silently create a second authentication model.

---

## 3. Approved Stack

Use the existing/approved stack:

- Flutter / Dart client.
- NestJS backend.
- TypeScript with `strict: true`.
- PostgreSQL hosted by Supabase.
- Supabase Auth.
- Prisma ORM with the PostgreSQL driver adapter as the primary application-table data-access layer.
- Prisma migrations as the single owner of future SafeNet application-schema changes after the existing database is introspected and baselined.
- Supabase JS SDK only for Supabase Auth and genuinely required admin-auth operations.
- Zod for runtime validation.
- Socket.IO through NestJS WebSocket Gateway for realtime features when realtime is required by the implemented feature.
- Firebase Admin / Firebase Cloud Messaging (FCM) for push notifications when configured.
- OpenAPI/Swagger through `@nestjs/swagger`.
- Jest / Supertest using the repository's existing NestJS test conventions.

Do NOT introduce without explicit approval:

- Express as a separately structured backend architecture outside NestJS internals.
- Next.js API routes.
- Fastify adapter if the project currently uses the default Nest platform.
- Drizzle, TypeORM, Sequelize, or another ORM in addition to Prisma.
- MongoDB or another database.
- A second JWT/authentication system.
- Redis.
- Kafka, RabbitMQ, BullMQ, or another queue/broker.
- Another realtime framework when Socket.IO/Nest Gateway is already approved.
- Twilio, Agora, or another call provider.
- External AI/LLM providers.

Use existing dependencies before adding new packages.

---

## 4. Existing-Base-First Rule

Before implementing any feature, inspect and reuse the existing NestJS base.

Find and reuse:

- `main.ts` bootstrap.
- `AppModule` and module import conventions.
- Existing feature modules.
- Config/environment module.
- Supabase module/client/provider.
- Authentication guard.
- Current-user decorator.
- Zod validation pipe/helpers.
- Global exception filter.
- Response interceptor/helper.
- Request ID / logging interceptor or middleware.
- Firebase Admin provider.
- Realtime Gateway infrastructure.
- Test utilities.
- Swagger setup.

Never build a second architecture beside the existing one.

Do not create a new Supabase client, logger, auth verifier, response wrapper, or config loader inside every feature.

Do not perform unrelated refactors while implementing a module.

Do not implement many large domains in one uncontrolled change. Work in dependency-ordered phases and verify each phase.

---

## 5. NestJS Architecture Rules

Use a module-based NestJS architecture.

Each domain should normally contain responsibilities equivalent to:

- `*.module.ts` - dependency wiring.
- `*.controller.ts` - HTTP endpoints only.
- `*.service.ts` - business logic and orchestration.
- `*.repository.ts` or the repository/data-access convention already used by the project - database queries.
- `dto/` or `schemas/` - Zod request/response validation schemas and inferred types.
- `*.constants.ts` / `*.errors.ts` where domain constants or error codes are needed.
- `*.spec.ts` - meaningful tests.

Controllers must remain thin.

Controllers may:

- read authenticated context;
- read validated params/query/body;
- call a service;
- map service results to the standard API response.

Controllers must NOT contain:

- complex authorization decisions;
- multi-write transaction logic;
- raw SQL/query-builder logic;
- FCM orchestration;
- fall-detection business rules;
- geofence state-machine logic;
- duplicate Supabase/Firebase initialization.

Business rules belong in services/domain helpers. Database access belongs in repositories/data-access providers.

The official application-data architecture is:

```text
Controller
â†’ Service
â†’ Repository / Data Access
â†’ PrismaService
â†’ Supabase PostgreSQL
```

Do not use the Supabase Data API (`supabase.from(...)`) as the normal application-table data-access mechanism. Supabase Auth remains separate and continues to own identities, passwords, and sessions.

Prefer NestJS dependency injection. Do not manually instantiate services/repositories/providers with `new` inside application code.

Shared code belongs under `src/common`, `src/config`, or `src/infrastructure` only when genuinely reusable. Do not turn shared modules into a dumping ground for business logic.

---

## 6. Suggested Project Structure

Follow the existing repository first. If a new base must be created, prefer this shape:

```text
src/
├── main.ts
├── app.module.ts
├── common/
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   ├── pipes/
│   ├── errors/
│   └── utils/
├── config/
├── infrastructure/
│   ├── supabase/
│   ├── firebase/
│   └── realtime/
└── modules/
    ├── auth/
    ├── profiles/
    ├── families/
    ├── devices/
    ├── locations/
    ├── geofences/
    ├── cameras/
    ├── fall-events/
    ├── reminders/
    ├── notifications/
    ├── sos/
    ├── phone-management/
    ├── daily-status/
    ├── conversations/
    └── calls/
```

Do not create a separate top-level architecture for every screen or API.

---

## 7. API Versioning

Application APIs should use `/api/v1` unless the existing project already has an approved convention.

Examples:

- `POST /api/v1/auth/login`
- `GET /api/v1/profiles/me`
- `GET /api/v1/families/:familyId`
- `GET /api/v1/notifications`
- `POST /api/v1/sos/events`

Configure the global prefix once in NestJS bootstrap where appropriate. Do not manually repeat incompatible prefixes across modules.

CRUD remains REST even when realtime/push exists.

---

## 8. Mandatory HTTP Status Codes

Use these meanings consistently across the whole API.

- `200 OK` - successful request returning a body.
- `201 Created` - new resource created successfully.
- `204 No Content` - successful operation intentionally returning no body.
- `400 Bad Request` - malformed request or validation failure.
- `401 Unauthorized` - authentication missing, invalid, or expired.
- `403 Forbidden` - authenticated user lacks permission.
- `404 Not Found` - requested resource does not exist or access policy intentionally hides it.
- `409 Conflict` - duplicate/conflicting resource state or incompatible idempotency-key reuse.
- `422 Unprocessable Content` - structurally valid request violates a business rule/state transition when appropriate.
- `429 Too Many Requests` - rate limit exceeded.
- `500 Internal Server Error` - unexpected server failure.

A `204` response MUST NOT contain a JSON body.

Use `400` for ordinary Zod request validation failures. Reserve `422` for domain/business-rule violations where that distinction adds value.

---

## 9. Mandatory API Response Contract

### Success

```json
{
  "success": true,
  "message": "Thành công",
  "data": {}
}
```

### Page-based list

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

### Cursor-based list

Use for fast-changing/high-volume streams such as messages, location history, notifications, and activity/event streams when cursor pagination is appropriate.

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

### Error

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

The Flutter client must branch on `error.code`, not message text.

Use a global NestJS exception filter/interceptor strategy to keep responses consistent. Do not hand-build a different error shape in each controller.

---

## 10. Error Codes

Maintain stable machine-readable error codes.

Minimum shared codes:

```text
VALIDATION_ERROR
INVALID_CREDENTIALS
UNAUTHORIZED
ACCESS_DENIED
TOKEN_EXPIRED
USER_NOT_FOUND
USER_ALREADY_EXISTS
FAMILY_NOT_FOUND
FAMILY_ACCESS_DENIED
RESOURCE_NOT_FOUND
RATE_LIMIT_EXCEEDED
INTERNAL_SERVER_ERROR
```

Add domain-specific codes where they improve client behavior, for example:

```text
FAMILY_MEMBER_ALREADY_EXISTS
FAMILY_INVITE_NOT_FOUND
FAMILY_INVITE_ALREADY_PROCESSED
LOCATION_SHARING_DISABLED
GEOFENCE_NOT_FOUND
FALL_EVENT_NOT_FOUND
FALL_EVENT_ALREADY_RESOLVED
SOS_EVENT_NOT_FOUND
SOS_INVALID_STATE
REMINDER_NOT_FOUND
CONVERSATION_ACCESS_DENIED
PHONE_COMMAND_CONFLICT
IDEMPOTENCY_CONFLICT
```

Do not change published error-code semantics casually.

---

## 11. Validation Rules

All untrusted input must be validated.

Validate when applicable:

- request body;
- route params;
- query params;
- relevant headers;
- uploads;
- webhook/event payloads;
- phone sensor fall payloads;
- camera fall payloads;
- third-party API responses used by business logic.

Use Zod as the project validation standard.

Prefer reusable NestJS Zod pipes/decorators rather than calling `schema.parse()` inconsistently across controllers.

Schemas should normally be `.strict()` for request objects unless extra fields are intentionally supported.

Validate UUIDs, enums, coordinates, timestamps, pagination limits, string lengths, array sizes, and state-transition inputs.

Never trust the Flutter client just because it already validates data.

---

## 12. Authentication Rules

SafeNet uses Supabase Auth.

Do NOT create a custom password table or second JWT issuer.

Protected requests use:

```text
Authorization: Bearer <Supabase access token>
```

The NestJS auth layer must:

1. extract the bearer token;
2. verify the token using the approved Supabase verification approach;
3. derive the authenticated user identity;
4. expose that identity through a reusable guard/decorator;
5. reject missing/invalid/expired credentials with the standard `401` contract.

Do not trust identity from request bodies when authenticated identity is available.

Never expose password hashes, refresh tokens, raw auth metadata, service-role keys, or other security-sensitive fields.

---

## 13. Authorization Rules

Authentication answers: "Who is this user?"

Authorization answers: "May this user perform this action on this resource?"

Authorization must be enforced before returning or mutating private resources.

Check as applicable:

- family membership;
- family role;
- ownership;
- resource membership;
- conversation membership;
- manager/caregiver permission;
- target member relationship;
- device ownership/binding;
- account/membership status.

Knowing a UUID never grants access.

Do not trust client-supplied actor fields such as:

- `userId`
- `ownerUserId`
- `senderId`
- `createdBy`
- `updatedBy`
- `resolvedBy`
- `handledBy`

When the actor is the current user, derive the value from the authenticated identity.

Prefer reusable Guards/decorators for broad checks and service-level authorization for resource-specific rules.

---

## 14. Family Role Model

SafeNet uses a capability-and-scope family model rather than a single `role` enum on `profiles` or `family_members`:

- **Family Owner (`isOwner`)**: derived from `families.owner_user_id = family_members.user_id`. Must be an adult (`>= 18` in `Asia/Ho_Chi_Minh`) and always has `can_manage_care = true`.
- **Care Manager (`canManageCare`)**: stored in `family_members.can_manage_care`. Only adults (`>= 18`) may hold `can_manage_care = true`.
- **Care Recipient (`isCareRecipient`)**: effective care recipient status is `isMinor(dateOfBirth) || family_members.is_care_recipient`. Minors (`< 18`) are always care recipients automatically; adults (`>= 18`) use `family_members.is_care_recipient`.
- **Hired Caregiver (`isHired` + `careScopeMemberIds`)**: derived from `family_label = 'caregiver'` (`family_members.is_hired = true`), scoped to specific care recipients via `family_member_care_scopes` (unless the hired caregiver is also the Family Owner).
- **UI Mode (`profiles.ui_mode`)**: `'kid' | 'adult' | 'assisted'`. Presentation preference only; never used for backend authorization.

A user may participate in different families with different labels, care flags, and scopes.

Manager/caregiver actions must explicitly verify the relevant family membership, `canManage(actor, target)` rules, and hired caregiver scopes via `FamilyAccessService`.

Membership status supports the approved states:

```text
pending
requested
accepted
rejected
removed
```

Do not treat `pending`, `requested`, `rejected`, or `removed` memberships as active access. Only `accepted` members in an `active` family have family access.

---

## 15. Supabase Auth and Profiles

Use:

```text
auth.users
    1:1
public.profiles
```

`auth.users` owns authentication concerns.

Prisma owns application-table access under `public`; it must not create, drop, or take migration ownership of Supabase-managed Auth tables. If a cross-schema Auth relation cannot be represented safely in Prisma, retain the UUID on the application model without weakening the real PostgreSQL foreign key.

`public.profiles` owns application-facing profile data such as:

- full name;
- avatar URL;
- date of birth;
- gender;
- account status;
- timestamps.

If an existing database trigger creates `public.profiles` after signup, do not create a second duplicate profile creation path.

---

## 16. Database Rules

PostgreSQL/Supabase is the source of truth.

Use database constraints in addition to TypeScript validation:

- `PRIMARY KEY`
- `FOREIGN KEY`
- `UNIQUE`
- `NOT NULL`
- `CHECK`
- sensible `DEFAULT`

Use timezone-aware timestamps (`TIMESTAMPTZ`) for real-world events unless an existing migration deliberately uses another type.

Add `created_at` / `updated_at` to persistent business entities where appropriate.

Use nullable fields intentionally.

Add indexes for fields frequently used for:

- authorization joins;
- foreign-key lookups;
- search;
- filtering;
- sorting;
- chronological feeds/history;
- high-volume event queries.

Do not use raw SQL inside services when the established data-access layer can express the query safely. Raw SQL belongs in migrations or a narrowly scoped repository when truly needed.

---

## 17. Migration Rules

Never edit a shared production database manually as the implementation mechanism.

After Prisma adoption, `prisma/migrations/` is the single owner of future SafeNet application-schema changes. Existing `supabase/migrations/` files are historical inputs and must remain until their schema plus custom SQL behavior has been represented and verified in Prisma migration history. Do not maintain two competing future migration histories.

For an existing populated database: introspect first, create and review a baseline, and mark it applied only when it matches the deployed schema. Never execute baseline SQL against the populated database, run an initial destructive migration, or use `prisma migrate dev` before baselining.

Preserve PostgreSQL features Prisma cannot modelâ€”including RLS, policies, functions, triggers, grants, and revokesâ€”through reviewed custom Prisma migrations.

All schema changes must be represented by forward migrations checked into Git.

Never rewrite an already-applied shared migration simply to make current code easier.

Before creating a migration:

1. inspect existing schema and migrations;
2. identify what already exists;
3. create only the delta required;
4. review destructive operations carefully.

Do not physically delete production data merely because a draft schema changed.

---

## 18. Transaction Rules

Use a database transaction when multiple writes represent one business operation and must succeed or fail together.

Examples:

- create family + create manager membership;
- accept invite + change membership state + audit record;
- append location + update `current_locations` when consistency is required;
- create fall event + persistent alert/notification/outbox records;
- create SOS event + notification/outbox/audit records;
- state transitions that update multiple related records.

Critical safety rule:

```text
validate
→ authenticate
→ authorize
→ idempotency check
→ database transaction
→ commit
→ realtime / FCM
```

Do not send the safety-critical notification first and save the event afterward.

---

## 19. Pagination, Filtering, Sorting, and Search

Never return unbounded database lists.

Page pagination example:

```text
?page=1&limit=20
```

Set a server-side maximum, normally `limit <= 100` unless a specific endpoint requires lower limits.

Prefer cursor pagination for:

- messages;
- location history;
- notifications;
- activity/event streams.

Whitelist filter and sort fields. Never pass arbitrary client-controlled field names directly to SQL/query builders.

Search must be sanitized/validated, limited, indexed where appropriate, and paginated.

---

## 20. Location Rules

Location is privacy-sensitive data.

For location updates:

- authenticate the sender;
- verify device/user/member binding;
- validate latitude, longitude, accuracy, timestamp, and optional motion values;
- enforce location-sharing state;
- store history when required;
- maintain `current_locations` consistently;
- apply geofence logic only after the location write is trusted.

For location reads:

- verify family/resource authorization;
- do not expose another user's coordinates merely because the caller knows their ID;
- limit history windows;
- paginate history;
- use indexes such as member/device + recorded time.

Do not include precise coordinates in generic request logs.

---

## 21. Geofence Rules

Geofences belong to a family and may target one or more family members.

Validate:

- family access;
- creator permission;
- target membership belongs to the same family;
- latitude/longitude;
- radius boundaries;
- active state.

Prevent noisy duplicate enter/exit events. Maintain enough state or logic to avoid creating repeated `enter` events for every location sample while a member remains inside a zone.

Create persistent `geofence_events` before generating downstream realtime/push notifications.

---

## 22. Fall Detection Rules

Fall detection is the highest-priority SafeNet feature.

The backend is responsible for the fall-event workflow, not for silently inventing an AI training pipeline.

A phone/camera detector may send a fall result. The backend must:

1. authenticate/verify the source according to the approved device/source contract;
2. validate the payload;
3. validate family/member/device/camera binding;
4. apply idempotency/deduplication;
5. persist the fall event;
6. persist notifications/outbox/audit data required by the workflow;
7. commit;
8. publish realtime/FCM afterward;
9. support status transitions such as `detected`, `confirmed`, `false_alarm`, `resolved` according to business rules.

Do not invent confidence thresholds unless the product specification defines them.

Do not call an external AI provider unless explicitly approved.

Do not claim camera/phone AI inference succeeded when the backend only received a result.

Treat sensor data, images, videos, and precise location as sensitive.

---

## 23. Camera Rules

Camera records are family-scoped resources.

Validate family authorization for create/read/update/delete operations.

Treat camera stream URLs, credentials, access tokens, and connection data as secrets/sensitive configuration.

Do not return raw private stream credentials in normal list APIs.

Do not log them.

Camera fall-detection integration must validate the camera-family-member relationship before creating a fall event.

---

## 24. Reminder Rules

Support:

- reminder CRUD;
- reminder type;
- start/end time;
- recurrence;
- multi-member targets;
- occurrence/status tracking;
- completed/missed/skipped states where required.

Prevent duplicate logical occurrence rows for the same reminder/member/scheduled occurrence.

Authorization must ensure the creator may manage reminders for the target family/member.

Do not rely only on a JSON repeat rule without validating its supported structure.

---

## 25. Notification Rules

Notifications are persistent user-owned records.

Support at minimum:

- list;
- unread count;
- mark one as read;
- mark all as read;
- cursor pagination for high-volume lists.

Potential types include:

```text
fall_detected
geofence_enter
geofence_exit
reminder
sos
system
```

FCM is delivery, not the source of truth.

Persist the notification first, then attempt push delivery.

Avoid duplicate notifications for the same logical critical event.

---

## 26. SOS Rules

SOS is safety-critical and duplicate-sensitive.

Support:

- emergency contact management;
- SOS trigger;
- SOS state transitions;
- handler metadata where required;
- location snapshot when available;
- persistent notifications/audit/outbox records.

Recommended flow:

```text
request
→ authentication
→ authorization
→ idempotency
→ transaction
   → create SOS event
   → create persistent notification/delivery records
   → create audit record when required
→ commit
→ realtime / FCM / external calling integration if configured
```

A failed FCM attempt must not erase an already committed SOS event.

Use explicit state-transition rules for states such as:

```text
triggered
calling
handled
cancelled
```

---

## 27. Device and Child-Phone Management Rules

Device records must belong to authenticated users and be safely associated with family members when management is allowed.

For usage logs:

- paginate history;
- validate time ranges and durations;
- restrict access to authorized managers/caregivers.

For phone rules:

- enforce target-child/member authorization;
- validate limits and bedtime ranges;
- keep change history/audit when appropriate.

For phone commands (`lock`, `ring`, `warning`, etc.):

- authorize the requester;
- make command creation idempotent where retries can happen;
- persist command first;
- do not mark it `completed` until the target device actually acknowledges execution;
- distinguish `pending`, `sent`, `completed`, and `failed` correctly.

Do not claim the backend can remotely lock a platform unless the Flutter/native device implementation supports that capability.

---

## 28. Daily Status Report Rules

Daily reports may summarize:

- location;
- phone usage;
- reminders;
- fall risk;
- activity level;
- AI-generated/derived data when a real approved source exists.

Enforce uniqueness for one logical report per member/date.

Do not fabricate AI analysis when no actual analysis component exists. The backend may expose persistence/contracts without pretending the AI result was generated.

---

## 29. Biometric Settings Rules

Backend biometric settings are preferences only.

The backend must NOT store raw fingerprint templates, face scans, secure enclave secrets, or operating-system biometric credentials.

Actual biometric verification belongs to the device/platform authentication mechanism.

Backend data may store only preference/status metadata such as whether the user enabled biometric login and the device-supported type when appropriate.

---

## 30. Chat Rules

Conversations are family/private resources.

Support direct and group conversations where required.

Every read/write must enforce conversation membership.

The sender identity comes from authentication, not the request body.

Persist a message before realtime emission.

Use cursor pagination for message history.

Prevent duplicate logical direct conversations between the same participant set where the product expects one direct thread.

Do NOT model group-message read state with only a global `messages.read_at`. Read/delivery state must be per recipient/user, for example through message receipts or a per-conversation read cursor.

---

## 31. Call Rules

Backend call support may include:

- call/session creation;
- participant authorization;
- incoming-call notification/signaling contract;
- call state transitions;
- call logs;
- duration metadata.

Do not claim real audio/video transport exists unless an actual approved WebRTC/call provider/native implementation exists.

If no media provider exists, implement only the backend contract/persistence/state machine that is internally supportable and document the external dependency.

---

## 32. Realtime Rules

Use NestJS WebSocket Gateway + Socket.IO for realtime capabilities when that transport is part of the current backend.

Authenticate the WebSocket handshake.

Authorize room subscriptions server-side.

Recommended room concepts may include:

```text
user:{userId}
family:{familyId}
member:{memberId}
chat:{conversationId}
```

Do not let a client subscribe to another user's/family's private room without authorization.

Critical realtime rule:

```text
DATABASE = SOURCE OF TRUTH
REALTIME = DELIVERY
FCM = DELIVERY
```

Persist and commit before emitting.

Design the Flutter client to recover authoritative state through REST/sync after reconnect/restart.

For safety-critical events, use idempotent event IDs and, when required by the repository design, a transactional outbox/retry mechanism.

Do not promise exactly-once delivery; design for duplicate-safe at-least-once behavior where reliability mechanisms are used.

---

## 33. Idempotency Rules

Duplicate-sensitive operations should support an `Idempotency-Key` or equivalent stable event ID when appropriate.

Important candidates:

- SOS trigger;
- fall-event ingestion;
- phone commands;
- invitation acceptance;
- critical notification creation;
- external/webhook callbacks.

Same idempotency key + same operation should return/reuse the original logical result.

Same key + conflicting payload should return `409 Conflict` with an appropriate error code.

---

## 34. Rate Limiting

Apply rate limits to sensitive/business-abusable endpoints.

Candidates include:

- login;
- register;
- forgot/reset password;
- OTP if introduced;
- invitations;
- SOS trigger;
- fall ingestion endpoints exposed to devices;
- uploads;
- public search.

Rate-limit values must be configurable and documented. Do not hard-code environment-specific production policy into controllers.

Use `429` and `RATE_LIMIT_EXCEEDED` consistently.

---

## 35. Request and Upload Limits

Limit:

- JSON body size;
- upload size;
- upload count;
- array lengths;
- number of IDs per request;
- history/query date range.

For uploads validate:

- permission;
- MIME type;
- supported extension when relevant;
- file size;
- file count;
- randomized/safe storage naming.

Never trust the client filename.

---

## 36. Security and Secrets

Never log or return:

- passwords;
- access tokens;
- refresh tokens;
- `Authorization` headers;
- OTPs;
- Supabase service-role/secret key;
- Firebase private key;
- database passwords;
- private camera stream credentials;
- precise location in generic logs.

Service-role credentials are server-only.

If service-role access bypasses RLS, backend authorization remains mandatory.

Use CORS allowlists appropriate to deployment. Do not use `*` casually for private APIs.

If backend functionality fetches client-supplied URLs, protect against SSRF and block local/private/metadata targets unless explicitly intended and safely handled.

---

## 37. Error Handling

Use a centralized domain/application error abstraction and global NestJS exception filter.

Errors should carry at least:

- HTTP status;
- stable error code;
- safe message;
- optional safe details.

Never return production stack traces, SQL errors, table names, internal Supabase errors, secret values, or raw third-party error bodies to clients.

Log internal details securely with request correlation.

---

## 38. Logging and Request IDs

Use structured logging.

Each request should have a request/correlation ID.

Useful structured fields include:

```text
level
requestId
userId (when safe)
method
path
statusCode
durationMs
```

Do not log sensitive values listed in the security section.

Critical events should have audit records where appropriate.

Suggested audit actions include:

```text
FAMILY_CREATED
MEMBER_INVITED
MEMBER_REMOVED
ROLE_CHANGED
SOS_TRIGGERED
SOS_HANDLED
FALL_CONFIRMED
FALL_RESOLVED
PHONE_COMMAND_CREATED
ACCOUNT_LOCKED
```

---

## 39. External Calls, Timeout, and Retry

Every outbound call must have an appropriate timeout.

Examples:

- Supabase Auth calls;
- Firebase/FCM;
- future camera/external services;
- future AI service;
- future call provider.

Retry only transient failures such as timeouts/network errors/selected `5xx` responses.

Do not retry ordinary `400`, `401`, `403`, validation, or permanent business-rule failures.

Critical retries must remain duplicate-safe.

---

## 40. Health and Operations

Provide a health endpoint such as:

```text
GET /api/health
```

Basic response:

```json
{
  "status": "ok"
}
```

If deployment requires it, add separate liveness/readiness endpoints.

Production observability should track at least:

- request count;
- latency;
- `4xx` rate;
- `5xx` rate;
- memory/CPU;
- database connections;
- slow queries;
- FCM/realtime failures;
- pending outbox events if an outbox exists.

---

## 41. Swagger / API Documentation

Use `@nestjs/swagger` and keep it aligned with actual API behavior.

Document for each important endpoint:

- URL;
- method;
- authentication requirement;
- authorization scope;
- params;
- query;
- body;
- success status and body;
- error statuses;
- error codes.

Do not publish Swagger examples that contradict the standard response contract.

---

## 42. Testing Rules

Backend requires meaningful tests at three levels where appropriate:

- unit tests;
- integration tests;
- API/E2E tests.

Test business behavior, not only line coverage.

Important protected API cases include:

- success;
- validation failure;
- missing token;
- invalid token;
- expired token;
- permission denied;
- not found;
- duplicate/conflict;
- invalid state transition;
- database/external delivery failure where behavior matters.

Important safety workflows such as SOS and fall alerts need transaction/idempotency/retry behavior tested.

Use Nest testing utilities (`@nestjs/testing`) and Supertest for E2E according to repository conventions.

---

## 43. Performance Rules

Avoid N+1 queries.

Prefer set-based/batched reads and intentional relation queries.

Select only required fields for stable API responses.

Do not return private/internal columns just because the database query fetched them.

Index chronological/high-volume queries.

Measure before adding caching infrastructure. Do not add Redis merely because a query could theoretically be cached.

---

## 44. Environment Variables

Maintain `.env.example` with variable names only and safe descriptions/defaults.

Never commit real `.env` files or secrets.

Server secrets must never use public-client prefixes.

Typical categories include:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY / ANON KEY when needed server-side
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
CORS_ORIGINS
RATE_LIMIT_* values
```

Use the repository's existing env naming convention rather than blindly renaming working variables.

Validate required environment variables at startup.

---

## 45. Git / CI / Build Rules

Do not commit:

- secrets;
- `.env` files except `.env.example`;
- private keys;
- `node_modules`;
- build artifacts unless repository policy requires them;
- logs;
- coverage output unless repository policy requires it.

Before a phase/feature is considered complete, run the repository's applicable commands for:

```text
lint
type-check
test
e2e test
build
```

At minimum, production build must pass.

Do not claim a feature is complete while the repository does not compile because of changes from that feature.

---

## 46. README Requirements

README should eventually contain:

- project description;
- supported Node version;
- installation;
- environment variables;
- development command;
- testing commands;
- build command;
- database migration workflow;
- Swagger/API docs location;
- deployment notes;
- project structure.

A new developer should be able to clone the repository and understand how to run it without hidden tribal knowledge.

---

## 47. SafeNet Domain Modules

The complete backend scope includes these domain areas. Implement them according to actual UI/spec requirements and dependency order.

### Auth

- Supabase registration/login/session integration.
- Authenticated-user lookup.
- Forgot/reset password contract where required.
- Guard-based protection.

### Profiles

- Public/private profile separation.
- Current profile get/update.
- Account status handling.

### Families / Family Members

- Family CRUD as allowed.
- Owner/manager membership.
- Invite/link by approved email/phone flow.
- Relationship label.
- Membership state transitions.
- Role/permission enforcement.

### Devices

- Device registration/refresh.
- FCM token management.
- Device status/last seen/battery metadata.

### Locations

- Current location update/read.
- Location history.
- Family map data.
- Privacy and sharing controls.

### Geofences

- Safe-zone CRUD.
- Member assignments.
- Enter/exit detection/events.
- Enter/exit notification settings.

### Cameras

- Camera metadata CRUD.
- Secure stream metadata handling.
- Fall-detection configuration/status.

### Fall Events

- Phone/camera fall-event ingestion.
- Evidence metadata.
- Confidence/result metadata.
- Confirm/false-alarm/resolve state transitions.
- Critical alert fanout.

### Reminders

- Reminder CRUD.
- Multi-member targets.
- Recurrence.
- Occurrence logs.
- Complete/missed/skipped updates.
- Appointment/medical reminder support through the approved reminder model.

### Notifications

- Persistent notification list.
- Unread count.
- Mark read/all read.
- Push delivery through FCM.

### SOS

- SOS contacts.
- SOS event trigger.
- State transitions.
- Critical notification/realtime behavior.

### Phone Management

- Usage history.
- Phone rules.
- Device commands such as lock/ring/warning when supported by the device client.

### Daily Status

- Daily member reports.
- Derived summaries when real source data exists.
- AI fields only when an approved AI component supplies them.

### Settings / Biometrics

- User settings.
- Biometric preference metadata only.

### Conversations / Messages

- Direct/group conversations.
- Conversation membership.
- Message persistence.
- Per-user read state.
- Realtime message delivery.

### Calls

- Call initiation/session metadata.
- Incoming-call signaling/notification contract.
- Call logs/state transitions.
- No fake media transport.

---

## 48. Database Draft Reconciliation Rules

The older SafeNet schema draft is a requirements reference, not a command to recreate it literally.

When reconciling it with current migrations, correct at least these concerns:

1. Use Supabase Auth + `public.profiles`, not custom `users.password_hash`.
2. Use timezone-aware event timestamps consistently.
3. Add appropriate FK/UNIQUE/NOT NULL/CHECK/default constraints.
4. Ensure `families.owner_user_id` and family membership stay logically consistent.
5. Prevent duplicate active/logical family memberships/invite actions.
6. Maintain consistent `locations` history + `current_locations` projection.
7. Ensure geofence target members belong to the geofence family.
8. Prevent duplicate/noisy geofence enter/exit events.
9. Validate fall-event `source_type` against `device_id`/`camera_id` and family/member binding.
10. Treat `cameras.stream_url` as sensitive.
11. Prevent duplicate reminder occurrences.
12. Add indexes for reminder occurrences and member/date queries.
13. Avoid one global `messages.read_at` for group chat; use per-user read state.
14. Prevent duplicate logical direct conversations.
15. Validate sender/conversation membership.
16. Add indexes for conversation/message chronological access.
17. Validate phone command target device/member/family authorization.
18. Enforce one daily report per member/date.
19. Keep FCM tokens/device identifiers appropriately protected and updateable.
20. Add idempotency/audit/outbox supporting tables only when required by actual reliability design.

---

## 49. Definition of Done for a Backend Feature

A feature is not done until applicable items are satisfied:

- Existing NestJS architecture was reused.
- Module/controller/service/repository boundaries are coherent.
- Zod validation exists for all untrusted request data.
- Authentication is enforced where required.
- Authorization is enforced where required.
- Correct HTTP status codes are used.
- Standard success/error response contracts are used.
- Stable error codes exist.
- Database constraints are sufficient.
- Required indexes exist.
- Multi-write operations use transactions.
- Duplicate-sensitive operations use idempotency where appropriate.
- Safety-critical data is committed before realtime/FCM delivery.
- Secrets/sensitive data are not leaked.
- Swagger is updated.
- Migrations are committed when schema changes.
- `.env.example` is updated for new variables.
- Unit/integration/E2E tests cover meaningful behavior.
- Lint passes.
- Type-check passes.
- Tests pass.
- `npm run build` passes.
- No unrelated refactor was introduced.
- No unauthorized technology was added.

---

## 50. Agent Working Rule

When asked to implement a SafeNet backend feature:

1. Read this file.
2. Inspect the existing repository and migrations.
3. Identify current conventions and dependencies.
4. Implement the smallest coherent domain slice.
5. Add/update migration only if needed.
6. Add validation/auth/authorization/error handling.
7. Add tests.
8. Update Swagger/docs.
9. Run lint/type-check/tests/build.
10. Fix implementation-caused failures before declaring completion.

Do not stop at scaffolding when the task asks for working backend behavior.

Do not pretend external capabilities exist. Implement the backend side fully, document the external dependency, and state exactly what remains outside the backend.
## AI Fall Detection Rules

Fall-detection AI is not implemented by the backend at the current stage.

The phone sensor model and camera fall-detection model are separate AI components
that will be trained and integrated later.

Backend agents must NOT:

- train a fall-detection model unless explicitly requested;
- introduce external AI providers;
- invent confidence thresholds;
- invent sensor classification rules;
- invent camera detection logic;
- mark AI fall detection as complete when no real model exists;
- block unrelated backend development while waiting for the AI model.

The backend may prepare and maintain interfaces for future fall-detection results.

The future backend responsibility is:

Detection result
→ validate source
→ authenticate/authorize
→ deduplicate/idempotency
→ persist fall event
→ create notifications
→ realtime delivery
→ FCM delivery
→ resolve/confirm/false-alarm lifecycle

AI inference itself is outside the NestJS backend responsibility unless
explicitly approved later.

The existing `fall_events` database model and related interfaces should remain
compatible with future phone-sensor and camera detection sources.