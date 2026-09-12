# SafeNet Backend Implementation Log

> Correction: the earlier Phase 0/1 entries below recorded implementation activity,
> but their `Completed` claims were invalidated by the security audit. The remediation
> entry dated 2026-08-19 is the authoritative status for Foundation and Phase 1.

## Overview

This log tracks the chronological implementation progress across all development phases of the SafeNet NestJS backend.

---

## [Phase 0] - Foundation & Architecture Baseline

- **Date**: 2026-08-19
- **Status**: Superseded — security audit found missing RLS and broken room authorization
- **Key Modules Added / Updated**:
  - `src/common/constants/`: standard `ErrorCode` and domain enums (`FamilyRole`, `MembershipStatus`, `DeviceType`, `FallEventStatus`, `SosEventStatus`, etc.).
  - `src/common/errors/`: `AppError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`, `BusinessRuleError`.
  - `src/common/filters/`: `GlobalExceptionFilter` enforcing the standard `{ success: false, error: { code, message, details } }` contract with sanitized server error responses.
  - `src/common/interceptors/`: `ResponseTransformInterceptor`, `RequestIdInterceptor`, `LoggingInterceptor` (structured JSON logging without credential or coordinate leaks).
  - `src/common/pipes/`: `ZodValidationPipe` for runtime body/query/param validation.
  - `src/common/decorators/`: `CurrentUser`, `Public`, `Roles`.
  - `src/common/guards/`: `SupabaseAuthGuard` (validates Bearer token via Supabase Auth `getUser`), `RolesGuard` (RBAC authorization), `ThrottlerGuard` (rate limiting).
  - `src/common/dto/`: `ApiResponse`, `PagePagination`, `CursorPagination`, `pagePaginationSchema`, `cursorPaginationSchema`.
  - `src/config/`: `env.validation.ts` (Zod schema validation), `configuration.ts`.
  - `src/infrastructure/supabase/`: `SupabaseModule` and `SupabaseService` (admin service_role client and auth token verifier).
  - `src/infrastructure/firebase/`: initial Firebase service; disabled behavior was later found to report fake success.
  - `src/infrastructure/realtime/`: initial gateway; the later audit found it checked only room prefixes and did not authorize family/member/chat resources.
  - `src/modules/health/`: `HealthModule`, `HealthController`, `HealthService` (`GET /api/v1/health`).
  - `src/main.ts`: global prefix `api/v1`, CORS, Swagger OpenAPI UI at `/api/docs`, body-parser size limits, and global pipes.
  - `supabase/migrations/`: `20260819000000_init_safenet_schema.sql` comprehensive schema migration.
  - `.env.example`: safe configuration template without secret values.
- **Verification Results**:
  - `lint`: 0 errors (Passed)
  - `test`: 5 test suites, 11 tests passed (Passed)
  - `test:e2e`: 1 test suite, 1 test passed (Passed)
  - `build`: Production NestJS build compiled successfully (Passed)

---

## [Phase 1] - Auth, Profiles & User Settings

- **Date**: 2026-08-19
- **Status**: Superseded — security audit found profile BOLA and incomplete hardening
- **Key Modules Added / Updated**:
  - `src/modules/auth/`:
    - `POST /api/v1/auth/register` (Email + password signup with profile auto-initialization).
    - `POST /api/v1/auth/login` (Authentication verification returning access token and refresh token).
    - `POST /api/v1/auth/refresh` (Session refresh).
    - `POST /api/v1/auth/forgot-password` (Password reset request).
    - `POST /api/v1/auth/reset-password` (Authenticated password update).
    - `GET /api/v1/auth/me` (Authenticated current user summary).
  - `src/modules/profiles/`:
    - `GET /api/v1/profiles/me` (Retrieve current user profile).
    - `PATCH /api/v1/profiles/me` (Update name, avatar URL, birthday, gender, phone).
    - `GET /api/v1/profiles/settings` (Retrieve push/SMS/email, location sharing, quiet hours preferences).
    - `PATCH /api/v1/profiles/settings` (Update notification & privacy settings).
    - `GET /api/v1/profiles/biometrics` (Retrieve biometric login preferences).
    - `PATCH /api/v1/profiles/biometrics` (Update biometric preference metadata without storing raw biometrics).
    - `GET /api/v1/profiles/:id` (Lookup user profile by ID).
  - Database mapping & repository queries for `profiles`, `user_settings`, `biometric_settings`.
- **Verification Results**:
  - `lint`: 0 errors (Passed)
  - `test`: 9 test suites, 22 tests passed (Passed)
  - `test:e2e`: 1 test suite, 1 test passed (Passed)
  - `build`: Production NestJS build compiled successfully (Passed)

---

## [Remediation] - Foundation & Phase 1 Security

- **Date**: 2026-08-19
- **Scope**: Foundation, configuration, Supabase, Firebase, realtime, Auth, Profiles, Settings, tests, Swagger and documentation only.
- **Security changes**:
  - Added forward migration `20260819010000_secure_foundation_phase1.sql` enabling/forcing RLS, revoking normal-client access by default and adding own-row Phase 1 policies with column-level grants.
  - Replaced prefix-only room joins with `RealtimeRoomAuthorizationService` checks for accepted family membership, member-family access and conversation membership.
  - Removed `GET /profiles/:id`; only authenticated own-profile access remains.
  - Removed the unsafe global role guard that treated Supabase global role as a family role. Family role authorization is deferred to Phase 2.
- **Auth and data access**:
  - Separated anon auth operations from explicit service-role administration/data access.
  - Signup now relies solely on the `auth.users` database trigger, which creates profile/settings/biometric rows in the auth transaction.
  - Added logout/session revocation and stable provider-error mapping.
- **Foundation changes**:
  - Production configuration fails fast for Supabase credentials and non-wildcard CORS allowlist.
  - REST and Socket.IO share configured CORS origin rules.
  - FCM uses typed `disabled/success/failure` results and never reports fake success.
  - Added separate liveness/readiness semantics with sanitized dependency failures.
  - Added non-mutating `lint:check` and explicit `typecheck` scripts.
- **Validation/API docs**:
  - Existing request schemas are strict and normalize/validate email, phone, password, dates and times.
  - Swagger documents implemented Phase 0/1 request schemas and standard error responses; unfinished domain tags were removed.
- **Tests added**:
  - RLS migration regression assertions.
  - Room authorization and gateway authentication/denial tests.
  - Production configuration, FCM disabled behavior and health readiness tests.
  - Duplicate registration, strict validation, private profile and missing/invalid token tests.
- **Verification**:
  - `lint:check`: passed (0 errors).
  - `typecheck`: passed.
  - Unit tests: 16 suites / 49 tests passed.
  - E2E tests: 1 suite / 6 tests passed.
  - `build`: passed.
- **Known limits**:
  - The RLS migration was not applied to a production database by this task; it must be exercised on a clean/staging Supabase environment before deployment.
  - Phase 2+ domain APIs and their domain-specific transactions/constraints remain intentionally unimplemented.

---

## [Final Foundation Fix] - Pre-Phase 2 blockers

- **Date**: 2026-08-19
- **Scope**: Foundation and Phase 1 only; no Families/Members or later-domain implementation.
- **Changes**:
  - Registration now treats provider errors and `{ user: null, error: null }` as sanitized internal failures; Supabase Auth plus the database trigger remains the only signup write path.
  - Socket.IO CORS is configured at bootstrap from the same validated `ConfigService` value used by REST; the gateway no longer reads environment state at module import time.
  - Added forward migration `20260819020000_server_managed_phase1_timestamps.sql` to revoke client control of `updated_at` and maintain it with database triggers.
  - Added concrete Swagger success payload schemas for Auth, Profiles, Settings, Biometrics and Health; logout remains a documented bodyless 204.
  - Added an explicitly opted-in live Supabase integration suite covering anonymous denial, own/foreign RLS, backend-only tables, admin access and deployed signup-trigger rows.
- **Verification**:
  - `lint:check`: passed.
  - `typecheck`: passed.
  - Unit tests: 18 suites / 65 tests passed.
  - Mocked E2E tests: 1 suite / 6 tests passed.
  - `build`: passed.
  - Live Supabase integration: `SKIPPED - LIVE SUPABASE ENVIRONMENT NOT CONFIGURED` (11 tests not run).
- **Known limits**:
  - Neither forward migration was applied by this task.
  - Live RLS and signup-trigger behavior remain unverified until the dedicated staging credentials and opt-in flag are provided.
  - The repository still has no commit/tracked-file baseline.

---

## [Phase 2] - Families and Family Members

- **Date**: 2026-08-20
- **Status**: Implemented; forward migration created but not automatically deployed.
- **Modules and routes**:
  - Added `FamiliesModule`, family/member controllers, `FamiliesService`,
    `FamiliesRepository`, and reusable `FamilyAccessService`.
  - Added family create/list/detail/update/archive routes.
  - Added accepted-member list/detail/update/remove routes.
  - Added invitation create/pending-list/accept/reject routes.
- **Authorization model**:
  - Roles are resolved from `family_members`; no global role guard is used.
  - Only `accepted` memberships in active families grant access.
  - Manager operations require an accepted manager in the target family.
  - Owner, self-role, manager-promotion, last-manager, and cross-family
    invariants are enforced server-side.
- **Transactions**:
  - Family creation and initial accepted manager membership use one Prisma
    transaction.
  - Invitation transitions and last-manager-sensitive member mutations use
    serializable Prisma transactions.
- **Migration**:
  - Added `20260820040000_phase2_family_integrity`.
  - Adds role/status/relationship-label checks and composite family/user status
    indexes without recreating existing tables.
  - Adds deferred constraint triggers requiring every active family's owner to
    be an accepted manager when the transaction commits.
- **RLS and delivery posture**:
  - Family tables remain backend-only for direct Supabase clients.
  - No Phase 3+ domain was implemented.
  - Invitation notifications/realtime are deferred to the Phase 6 persistent
    notification delivery domain; pending invitations are available through REST.
- **Tests**:
  - Unit coverage includes transaction rollback, access statuses, manager
    authorization, invitation conflicts/transitions, role escalation,
    cross-family protection, removal, last-manager protection, and validation.
  - E2E covers the User A create/invite, User B pending/accept/access, User C
    denial, non-manager denial, and removed-member access-loss flow.
- **Known limitations**:
  - Ownership transfer is intentionally not exposed in Phase 2.
  - The new forward migration must be reviewed and deployed separately.

---

## [Phase 2 Final Audit + Phase 3] - Devices

- **Date**: 2026-08-20
- **Phase 2 audit**:
  - Independently reviewed family transactions, accepted-manager ownership,
    manager/owner permissions, invitation transitions, cross-family scoping,
    strict validation, safe projections, Swagger, migration SQL, and tests.
  - No critical or high-severity authorization issue was found. No Phase 2
    runtime fix was required; documentation-only deferred-item drift was fixed.
  - Baseline verification before Phase 3: 24 unit suites / 102 tests, 2 E2E
    suites / 8 tests, and 11 / 11 live Supabase tests passed.
- **Phase 3 module and routes**:
  - Added `DevicesModule`, controller, service, repository, Zod DTOs, explicit
    Swagger schemas, unit tests, and HTTP E2E coverage.
  - Added create/register, owner list/detail/update, heartbeat, and soft
    deactivation routes under `/api/v1/devices`.
- **Ownership and identity**:
  - Ownership always comes from the verified Supabase actor; request ownership
    fields are rejected.
  - `device_identifier` is exposed internally as `installationId`, a required
    random UUID generated per Flutter installation. Repeated registration
    updates the same row. An active installation owned by another account
    returns `DEVICE_INSTALLATION_CONFLICT`; an inactive released installation
    may be reassigned.
  - All ID-based reads and writes include `userId` ownership scope. Family
    managers receive no mutation authority over another user's device.
- **FCM lifecycle**:
  - FCM tokens are optional mutable delivery metadata, never identity or
    authorization. Registration and PATCH support rotation.
  - A newly presented token is detached from stale rows in the same serializable
    transaction before assignment. Unique database enforcement plus retry
    handling protects concurrent rotation.
  - Soft deactivation is idempotent and clears the token. Safe projections and
    Swagger responses exclude both FCM token and installation identity.
- **Heartbeat and deactivation**:
  - Heartbeat accepts only an optional 0..100 battery percentage and sets
    `lastSeenAt`/`updatedAt` on the server.
  - Location coordinates and client-controlled timestamps are rejected.
  - DELETE preserves the row and FK history, marks it inactive, and returns a
    bodyless 204. Registration is the only reactivation path.
- **Migration**:
  - Added `20260820050000_phase3_device_integrity` without table recreation,
    schema drops, truncation, or deletion.
  - Adds non-null identity/platform/lifecycle fields, `updated_at`, supported
    platform and battery checks, and unique installation/FCM indexes.
  - The deployed device table was empty at inspection time. The migration is
    forward-only and was not automatically deployed.
- **Scope boundaries**:
  - Device APIs remain owner-only; family monitoring is deferred until later
    location/monitoring rules are defined.
  - The existing table has no app-version or structured permission columns;
    Phase 3 does not invent them. A future schema decision is required before
    those metadata fields can be accepted.
  - No location history/current-location, notifications, fall detection,
    sensor AI, or camera AI was implemented.
  - Phone Fall AI = DEFERRED. Camera Fall AI = DEFERRED.
- **Live test reliability**:
  - The test-scoped signup-trigger check now falls back to Supabase Admin user
    creation only when the public signup call is rejected by the project's
    email-send rate limit. Both paths insert `auth.users`, assert all three
    trigger-created Phase 1 rows, and delete the temporary user. RLS assertions
    and expected row checks are unchanged.
- **Final verification**:
  - Prisma migrate status: six migrations found; Phase 2
    `20260820040000_phase2_family_integrity` and Phase 3
    `20260820050000_phase3_device_integrity` are pending by design.
  - Prisma validate: passed. Prisma generate: passed.
  - Lint: passed. Typecheck: passed. Build: passed.
  - Unit: 29 suites / 123 tests passed.
  - E2E: 3 suites / 13 tests passed.
  - Live Supabase: 1 suite / 11 tests passed.

---

## [Phase 3 Final Audit + Phase 4] - Locations and Family Map

- **Date**: 2026-08-24
- **Phase 3 audit**:
  - Verified deployed device columns, checks, unique indexes, foreign key and
    forced-RLS posture against the implementation.
  - Re-audited actor-derived ownership, installation idempotency, active
    installation conflict behavior, global FCM uniqueness/detachment,
    deactivation, heartbeat, strict DTOs, safe projections, Swagger and tests.
  - No critical, high, medium-integrity, low or documentation issue required a
    Phase 3 code change.
- **Phase 4 architecture**:
  - Added `LocationsModule`, controller, service, repository, strict Zod DTOs,
    concrete Swagger schemas, migration regression checks, unit and HTTP E2E
    coverage.
  - Location history is authoritative per user/device. `current_locations` is
    one newest point per user across all owned active devices.
  - The existing member columns remain nullable for legacy provenance; family
    authorization joins accepted memberships to the authoritative user key.
- **Write and consistency rules**:
  - Actor identity comes only from the verified Supabase user. Device lookup is
    scoped by device ID + user ID and requires `isActive=true`.
  - A serializable transaction verifies ownership, inserts history, performs a
    parameterized conditional PostgreSQL upsert, and updates device last-seen.
  - The upsert advances current state only for a newer `recorded_at`, using the
    history UUID as deterministic tie breaker for equal capture timestamps.
    Bounded retry handles recognized serialization conflicts.
  - Server receive time is `created_at`/`updated_at`; client `recordedAt` is only
    capture time and may not be more than five minutes in the future.
- **Read privacy**:
  - Own current and cursor-paginated own history are available to the actor.
  - Family Map and member-current reads require an accepted caller in the
    active target family, an accepted target in that exact family, and both
    global and membership-level target sharing enabled.
  - Another member's historical locations are not exposed.
- **Realtime**:
  - `location.updated` emits only after transaction commit and only when the
    current projection advanced.
  - Delivery uses private `user:{id}` rooms for the owner and users who are
    currently accepted in a shared active family. This avoids relying on stale
    broad family-room membership.
  - Payloads exclude FCM token, installation ID, device ID and auth metadata.
  - No FCM delivery occurs for routine points.
- **Migration**:
  - Added pending `20260824060000_phase4_location_integrity`.
  - Evolves existing tables without recreation, deletion or RLS changes; the
    deployed `locations` and `current_locations` tables contained zero rows.
  - Adds user/device provenance, separate receive time, coordinate/telemetry
    checks, deterministic history indexes and per-user current-state identity.
- **Scope**:
  - Geofences and safe-zone enter/exit are not implemented.
  - SOS, notification workflows and all fall inference remain unimplemented.
  - Phone Fall AI = DEFERRED. Camera Fall AI = DEFERRED.
- **Final verification**:
  - Prisma status: seven migrations found; only
    `20260824060000_phase4_location_integrity` is pending by design.
  - Prisma validate: passed. Prisma generate: passed.
  - Lint: passed. Typecheck: passed. Build: passed.
  - Unit: 34 suites / 156 tests passed.
  - E2E: 4 suites / 18 tests passed.
  - Live Supabase: 1 suite / 11 tests passed.

### Phase 4 targeted realtime privacy audit

- **Date**: 2026-08-24
- **Finding and fix**:
  - Owner global sharing, owner per-family sharing, accepted status and active
    family were already required before family realtime fanout.
  - Recipient resolution required accepted status and active family but did not
    require the recipient membership's per-family sharing flag.
  - Added `locationSharingEnabled=true` to recipient membership resolution.
    Delivery remains private `user:{id}` fanout; no broad family room is used.
- **Verified policy**:
  - The owner always receives their own safe private event when current state
    advances.
  - Other users receive it only through an active family where source and
    recipient relationships are accepted and per-family sharing is enabled,
    and the source's global sharing is enabled.
  - Pending, rejected, removed, unrelated and inactive-family relationships
    receive nothing.
- **Regression verification**:
  - Lint: passed. Typecheck: passed. Build: passed.
  - Unit: 34 suites / 158 tests passed.
  - E2E: 4 suites / 19 tests passed.
  - Live Supabase: 1 suite / 11 tests passed.

---

## [Phase 4 Final Audit + Phase 5] - Geofences / Safe Zones

- **Date**: 2026-08-24
- **Phase 4 final audit**:
  - Confirmed all seven Phase 0-4 migrations were deployed before implementation.
  - Re-audited owned active-device writes, serializable history/current
    consistency, stale/equal-time ordering, retry and parameterized SQL safety,
    strict capture/coordinate validation, own and family reads, cursor history,
    BOLA protection, commit-before-emit, safe payloads, and the no-FCM boundary.
  - Verified family realtime recipients require an active family, accepted
    source and recipient memberships, source global sharing, and source and
    recipient per-family sharing. Owner delivery remains private and no broad
    family-room location broadcast is used.
  - No Phase 4 runtime fix was required.
- **Phase 5 module and routes**:
  - Added `GeofencesModule` with controller/service/repository boundaries,
    strict Zod schemas, concrete Swagger bodies/responses, isolated Haversine
    geometry, durable evaluation service, unit coverage, and HTTP E2E coverage.
  - Added manager-only create/update/deactivate/member-replacement routes,
    accepted-member read/list routes, and a privacy-filtered cursor event feed
    under `/api/v1/families/:familyId/geofences`.
- **Permission and lifecycle policy**:
  - Accepted members in an active family may read safe zones and permitted
    event history. Only managers may create, update, deactivate, or replace
    assignments. Adult/child/elder roles have no mutation authority by default.
  - Assignments accept only accepted members of the same family and are replaced
    atomically. Client creator/family/event/transition fields are rejected.
  - DELETE is a bodyless 204 soft deactivation; history is preserved and an
    inactive zone is excluded from future evaluation. PATCH may reactivate it.
- **Geometry and state machine**:
  - Phase 5 retains circular geometry and uses Haversine distance with a
    6,371,000-meter mean Earth radius. Boundary points are inside.
  - Latitude/longitude use standard geographic bounds. Radius is currently
    1..100,000 meters. The 100 km ceiling is a technical defensive guard already
    enforced by the deployed schema, not an approved product requirement; no
    different product limit was invented during the final audit.
  - First observation establishes state without fabricating a transition.
    Outside-to-inside persists `enter`; inside-to-outside persists `exit`;
    same-state observations produce no event.
- **Location integration and privacy**:
  - Evaluation runs only after Phase 4 commits and only when the per-user current
    projection advanced. Stale history points never enter Phase 5 evaluation.
  - Source membership must be accepted in an active family with both global and
    per-family sharing enabled. Assignment never overrides privacy. Event history
    applies the same current source-sharing checks.
- **Concurrency and idempotency**:
  - Added `geofence_states`, uniquely keyed by geofence/member, with last source
    location UUID and capture time. Evaluation uses serializable transactions,
    parameterized PostgreSQL transaction advisory locks, deterministic timestamp/
    UUID ordering, bounded serialization retry, and unique event provenance.
  - State update and transition event insert are one transaction. Concurrent
    enter/exit evaluation produces at most one logical transition, and retrying
    the same location cannot create another event.
- **Database integrity and migration**:
  - Added pending forward migration
    `20260824070000_phase5_geofence_integrity`; it was not deployed automatically.
  - It adds geometry/event checks, family provenance on assignments, durable
    state, event source/created timestamps, useful chronological indexes, and a
    trigger enforcing geofence/member/family/location consistency.
  - The new state table has forced RLS and no direct anon/authenticated grants.
    Existing deployed geofence, assignment, and event tables each contained zero
    rows at inspection. The migration contains no table/schema drop, truncate,
    delete, or RLS disable operation.
- **Realtime and scope**:
  - Persisted transitions emit `geofence.entered` or `geofence.exited` only after
    commit to privacy-authorized private user rooms. Payloads contain only safe
    zone/member/transition/coordinate/time fields.
  - Assignment enter/exit preferences control realtime delivery; durable
    transition history is still retained. There is no global/family-room fanout.
  - No FCM, notification-domain workflow, AI, SOS, or Phase 6+ feature was added.
  - Phone Fall AI = DEFERRED. Camera Fall AI = DEFERRED.
- **Known limitation**:
  - Phase 5 intentionally has no GPS-boundary hysteresis/cooldown because no
    product threshold is approved; the transition state machine prevents
    repeated same-state spam, while explicit hysteresis remains a future policy.
- **Final verification**:
  - Prisma status: eight migrations found; only
    `20260824070000_phase5_geofence_integrity` is pending review by design.
  - Prisma validate: passed. Prisma generate: passed.
  - Lint: passed. Typecheck: passed. Build: passed.
  - Unit: 43 suites / 209 tests passed.
  - E2E: 5 suites / 24 tests passed.
  - Live Supabase: 1 suite / 11 tests passed.

---

## [Phase 5 Final Audit + Phase 6] - Notifications / FCM

- **Date**: 2026-08-27
- **Deployment gate and Phase 5 audit**:
  - Confirmed all eight Phase 0-5 migrations were deployed before Phase 6 work.
  - Re-audited Phase 5 authorization, family isolation, location privacy,
    recipient privacy, event-history visibility, durable transition state,
    unique provenance, serializable retry, advisory locking, RLS, triggers,
    Swagger, validation, and tests. No runtime privacy or transition fix was
    required.
  - Event history remains stored authoritatively while the API hides source
    events when current global/per-family sharing no longer permits visibility.
    Historical rows are not deleted.
  - Aligned two Prisma annotations with the deployed Phase 5 DB: assignment
    notification flags are non-null and the family index is modeled.
- **Notification architecture and source of truth**:
  - Added `NotificationsModule` with owner-scoped list/detail/unread/read/read-all
    APIs, strict DTOs, opaque `(createdAt,id)` cursor pagination, concrete
    Swagger schemas, stable errors, and safe response mapping.
  - Database notifications are authoritative. Geofence ENTER/EXIT is the only
    Phase 6 producer. Each authorized user receives one record; active devices
    with current tokens receive independent pending delivery rows.
  - Uniqueness on recipient + source type + source event makes repeated handling
    idempotent. An event-scoped transaction advisory lock serializes creation.
- **Recipient and preference policy**:
  - Creation re-reads the event and requires an active family, accepted source,
    source global and per-family sharing, explicit assignment, and the matching
    enter/exit preference.
  - Recipients must be accepted in that active family and have membership-level
    sharing enabled. Disabled push suppresses FCM rows, while the authorized
    in-app record remains available.
- **Commit and delivery order**:
  - Geofence transaction commits, then notifications and pending delivery rows
    commit, then `notification.created` emits to `user:{userId}`, then bounded
    FCM runs outside database transactions.
  - DB, realtime and FCM share one stable notification ID. Payloads contain no
    coordinates, token, installation ID, auth data, or raw provider errors.
- **FCM lifecycle and failures**:
  - Firebase Admin is reused. Tokens are read only from current active Device
    rows and are never copied into notification records or responses.
  - Success marks a device delivery sent. Recognized transient failures receive
    at most two attempts and never clear tokens. Permanently invalid registration
    tokens are conditionally cleared without deactivating devices.
  - Provider/realtime failure cannot roll back location, geofence event, or
    notification persistence. No durable worker exists yet; retry is bounded and
    synchronous, and failed rows remain auditable.
- **Migration**:
  - Created but did not deploy
    `20260827080000_phase6_notifications_delivery`.
  - It safely normalizes nullable legacy state, adds metadata and source
    uniqueness, and adds forced-RLS backend-only per-device delivery tracking.
    It contains no drop, truncate, delete, table recreation, column removal, or
    RLS weakening.
- **Scope**:
  - SOS, falls, reminders, chat, calls, phone commands, camera workflows and all
    later notification producers remain unimplemented.
  - Phone Fall AI = DEFERRED. Camera Fall AI = DEFERRED.
- **Verification**:
  - Prisma validate/generate, lint, typecheck and build passed.
  - Unit: 48 suites / 237 tests passed.
  - E2E: 7 suites / 33 tests passed.
  - Live Supabase: 1 suite / 11 tests passed.
  - Prisma status intentionally reports only the new Phase 6 migration pending
    manual deployment; it was not deployed automatically.

---

## [Phase 6 Final Audit + Phase 7] - SOS / Emergency

- **Date**: 2026-08-31
- **Deployment gate and Phase 6 audit**:
  - Confirmed all nine Phase 0-6 migrations were deployed before Phase 7 work.
  - Re-audited persisted notification authority, source-event uniqueness,
    recipient and delivery fanout, token confidentiality and rotation, permanent
    versus transient failures, bounded retry, Firebase-disabled behavior,
    transaction boundaries, private realtime, owner APIs, pagination, RLS,
    validation, Swagger, tests, and geofence privacy inheritance.
  - No Phase 6 runtime, privacy, authorization, idempotency, or delivery-integrity
    fix was required. Permanent token failures clear only the matching token;
    transient failures retain it; neither path deactivates a Device or removes
    notification/delivery/domain history.
- **Manual SOS actor and lifecycle**:
  - Added manual authenticated-user SOS only. Actor identity always comes from
    the verified Supabase token; client actor, recipient, status, source, and
    timestamp fields are rejected by strict Zod schemas.
  - `(actorUserId, clientRequestId)` plus a canonical request fingerprint is the
    durable idempotency key. Actor advisory locking, serializable retry, the DB
    unique constraint, and one-active-incident partial uniqueness protect
    concurrent retries and duplicate emergencies.
  - The state machine is `active -> resolved` or `active -> cancelled`. Repeating
    the same terminal action is idempotent; cross-terminal transitions fail.
- **Emergency contacts and recipients**:
  - Added private, owner-scoped contact list/create/update/delete APIs. Linked
    SafeNet users must be accepted co-members in an active family; external
    phone contacts remain callable configuration and never fabricate FCM users.
  - The server resolves accepted members of the actor's active families,
    excludes unrelated/pending/rejected/removed relationships, deduplicates all
    paths, and stores immutable `SosRecipient` provenance. Actor and durable
    recipients may read detail; history and state changes remain actor-only.
- **Emergency location semantics**:
  - SOS snapshots the actor's server-side `CurrentLocation` at activation.
    Missing location never blocks SOS. Client coordinates are not accepted, and
    later current-location changes cannot alter the incident snapshot.
  - Manual SOS is an explicit, incident-scoped authorization to disclose that
    snapshot to its durable recipients. It does not change or bypass passive
    Family Map behavior and does not modify global/per-family sharing settings.
- **Notification, FCM, and realtime integration**:
  - Each durable SOS recipient gets one `sos_alert` Notification keyed by the
    SOS source event; each current active token-bearing Device gets one delivery
    row. Reprocessing is idempotent and multi-device fanout does not duplicate
    the logical notification.
  - SOS commits first; notification records commit next; safe `sos.created` and
    `notification.created` events go only to `user:{userId}` rooms; FCM is then
    attempted outside every transaction through `NotificationsService`.
  - FCM or Socket.IO failure cannot erase the SOS, recipient provenance, or
    Notification. If durable notification creation fails, the SOS remains but
    no downstream realtime/push success is claimed. Push payloads contain
    identifiers only, not coordinates, tokens, installation IDs, auth metadata,
    or provider internals.
- **Migration**:
  - Created but did not deploy `20260831090000_phase7_sos_integrity`.
  - It safely evolves the existing legacy contact/event tables, adds actor and
    idempotency integrity, immutable snapshots, lifecycle checks, one-active
    enforcement, durable recipients, indexes, forced RLS, backend-only grants,
    update guards, and SOS notification source checks.
  - The migration contains no table/schema drop, truncate, delete, column drop,
    unsafe table recreation, or RLS weakening. Legacy foreign keys are replaced
    with lifecycle-safe actions after data validation.
- **Scope and limitations**:
  - No telephony provider is claimed or added. External numbers are returned
    only as the owner's private contact configuration.
  - Notification delivery remains bounded and synchronous; no durable background
    retry worker is introduced in Phase 7.
  - Phone Fall AI = DEFERRED. Camera Fall AI = DEFERRED. Automatic fall-triggered
    SOS = NOT IMPLEMENTED. Phase 8 is not implemented.

---

## [Phase 7 Final Audit + Phase 8 Deferred + Phase 9] - Reminders

- **Date**: 2026-08-31
- **Database gate and Phase 7 audit**:
  - Confirmed all ten migrations through `20260831090000_phase7_sos_integrity`
    were deployed and Prisma reported the database up to date before Phase 9.
  - Independently re-audited authenticated actor derivation, strict manual-only
    activation, request fingerprint/idempotency, actor advisory locking,
    one-active integrity, lifecycle, optional owned Device validation, immutable
    CurrentLocation snapshots, no-location behavior, accepted recipient
    resolution, durable `SosRecipient` authorization, private contacts,
    Notification integration, FCM/Socket failure isolation, protected history
    and detail, RLS, Prisma architecture, Zod, Swagger, and tests.
  - Phase 7 passed with no runtime, privacy, authorization, idempotency, or
    emergency-integrity fix required. Incident location authorization remains
    incident-scoped and never changes passive location-sharing settings.
- **Phase 8 status**:
  - Phase 8 is DEFERRED — WAITING FOR AI MODEL / real output contract.
  - Phone sensor fall AI = DEFERRED. Camera fall AI = DEFERRED. Fall Detection
    Backend = DEFERRED. No model, inference, threshold, fake fall result, endpoint,
    external AI integration, or automatic fall-to-SOS workflow was added.
- **Reminder permissions and privacy**:
  - Accepted managers of active families may create, update, retarget, reactivate,
    or deactivate family reminders. Adult/child/elder targets do not gain mutation
    rights. Actor identity is always authentication-derived.
  - Targets must be accepted members of the same active family. Foreign,
    pending, rejected, removed, duplicate, and cross-family targets are rejected
    before the atomic reminder/target write.
  - Reminder visibility is conservative: creator, current accepted family
    managers, and current accepted targets only. Detail, upcoming data, and logs
    reuse that scope; a UUID is never sufficient authorization.
- **Schedule and timezone model**:
  - Supports structured `once`, `daily`, and `weekly` schedules; weekly schedules
    use a unique selected-weekday array. Arbitrary cron input is not accepted.
  - Every schedule carries an IANA timezone. Recurring local wall-clock intent is
    converted deterministically with `Intl`; DST offset changes preserve local
    time and nonexistent DST wall times are skipped rather than shifted silently.
  - `nextOccurrenceAt` is database state indexed with `isActive`. Schedule updates
    recalculate future state and never rewrite historical ReminderLogs.
- **Scheduler, restart, and idempotency**:
  - A bounded Nest lifecycle timer queries at most 50 indexed due reminders per
    minute; no Redis, queue, broker, or global in-memory occurrence set was added.
  - Each claim uses a serializable transaction and reminder-scoped PostgreSQL
    advisory lock. `UNIQUE(reminder_id, member_id, scheduled_at)` is the durable
    cross-instance occurrence invariant. Targets, logs, and next-due advancement
    commit before notification orchestration.
  - Restart catch-up is limited to 15 minutes. Older stored due work records one
    `missed` occurrence per target, fast-forwards deterministically to the next
    future occurrence, and sends no stale notification; unlimited replay is not
    performed.
  - Deactivation clears next-due state without deleting reminder or log history.
- **Notification and failure semantics**:
  - A due ReminderLog is the stable Notification source. Each accepted target gets
    one `reminder` Notification per log and one delivery row per active token
    Device. `notification.created` private-room realtime is reused; no redundant
    reminder event was introduced.
  - Reminder code never calls Firebase. Notification/FCM runs only after occurrence
    commit. FCM failure cannot delete Reminder, ReminderLog, Notification, or
    delivery history.
  - `notificationProcessedAt` is a durable orchestration marker. Notification DB
    failure leaves it unset for bounded later scheduler retry; source uniqueness
    prevents duplicates after partial/restarted processing.
- **Migration**:
  - Created but did not deploy `20260831100000_phase9_reminders_integrity`.
  - It safely adds timezone/next-due state, schedule/log checks, occurrence and
    due-work indexes, notification retry state, Reminder Notification source
    integrity, history-preserving foreign keys, and forced backend-only RLS.
  - It contains no table/schema/column drop, truncate, delete, table recreation,
    or RLS weakening. Existing deployed Reminder tables contained zero rows at
    inspection.
- **Limitations**:
  - The scheduler is database-safe across instances but remains an in-process
    timer, so operational monitoring must ensure at least one backend instance is
    running. It intentionally avoids unapproved queue infrastructure.
  - Phase 9 does not implement user acknowledgment/completion/taken workflows;
    logs represent only due processing or bounded missed execution.

---

## [Phase 9 Final Audit + Phase 10] - Camera Management

- **Date**: 2026-08-31
- **Database gate and Phase 9 audit**:
  - Confirmed all eleven migrations through
    `20260831100000_phase9_reminders_integrity` were deployed before Phase 10.
  - Re-audited creator derivation, manager mutation, target validation, strict
    schedules, IANA/DST behavior, indexed next-due work, scheduler bounds and
    lifecycle, serializable/advisory claims, occurrence/source uniqueness,
    durable logs, notification retry, FCM isolation, technical catch-up,
    deactivation, historical integrity, architecture, RLS, validation, Swagger,
    tests, and documentation.
- **Phase 9 authorization fixes**:
  - Removed the unconditional creator-ID visibility bypass. A creator must retain
    current accepted membership in the active reminder family; current managers
    and current accepted targets remain independently authorized.
  - Execution and notification retry now revalidate active family, accepted
    member state, same-family binding, and current ReminderTarget assignment.
    Removed/rejected/pending targets and inactive families receive no future or
    retried Reminder Notification.
  - Added DB triggers enforcing ReminderTarget/ReminderLog member-family
    consistency. Scheduler locking, occurrence uniqueness, notification retry,
    once termination, and `notificationProcessedAt` behavior remained correct.
  - The 15-minute missed window is documented as a technical scheduler policy,
    not an approved product requirement.
- **Camera ownership and permissions**:
  - Cameras are immutable-family resources under
    `/api/v1/families/:familyId/cameras`. Actor and family authorization are
    server-derived; client ownership fields are rejected.
  - Accepted managers of active families create, update, reactivate, deactivate,
    list, and read. Accepted adults read active safe metadata only. Because no UX
    rule approves child/elder camera visibility, both are conservatively denied.
    Pending/rejected/removed and unrelated users have no access.
  - Both route family ID and camera ID are scoped. Cross-family UUID substitution
    returns the stable access/not-found contract.
- **Camera lifecycle and safe metadata**:
  - Creation produces active configuration. PATCH allowlists name, location
    label, write-only connection URL, and configured active state. DELETE is an
    idempotent soft deactivation; hard deletion and family transfer are absent.
  - Responses expose only ID, family ID, name, location label, configured active
    state, `connectivityStatus: unknown`, connection-presence boolean, and server
    timestamps. No stream URL, credentials, creator internals, online timestamp,
    installation data, Firebase data, or AI state is serialized.
- **Connection secrecy, SSRF, and connectivity truthfulness**:
  - Legacy `stream_url` is treated as a write-only connection secret and accepts
    only syntactically valid `rtsp`, `rtsps`, or `https` URLs. No API, Swagger
    response, log, realtime event, FCM payload, or exception intentionally emits
    the stored value.
  - The project has no approved field-level encryption/key-management facility;
    the value remains plain PostgreSQL data protected by forced RLS/backend-only
    access. Application-level encryption at rest remains technical debt.
  - Camera code performs no fetch, probe, ping, heartbeat, DNS lookup, or outbound
    request. SSRF-capable connection testing is not implemented.
  - Legacy `last_online_at` is not client-writable or exposed. With no trusted
    camera heartbeat/provider, connectivity is always reported as `unknown`.
- **Explicit deferrals**:
  - Camera Playback / Secure Streaming = DEFERRED. No RTSP proxy, WebRTC, HLS,
    transcoding, recording, snapshot, relay, or credential-return endpoint exists.
  - Camera Fall AI = DEFERRED. Phone Fall AI = DEFERRED. Fall Detection Backend =
    DEFERRED. Video/frame processing and automatic camera-to-SOS/Notification are
    NOT IMPLEMENTED.
- **Migration**:
  - Created but did not deploy
    `20260831110000_phase9_hardening_phase10_cameras`.
  - It adds Reminder family-consistency triggers, normalizes legacy inactive/AI
    preference state, camera lifecycle constraints, family/status index,
    history-safe foreign keys, and forced backend-only RLS.
  - Deployed cameras contained zero rows during inspection. The migration has no
    table/schema/column drop, truncate, delete, table recreation, or RLS weakening.

---

## [Phase 10 Final Audit + Phase 11] - Phone Management

- **Date**: 2026-09-01
- **Database gate and Phase 10 audit**:
  - Confirmed all twelve migrations through
    `20260831110000_phase9_hardening_phase10_cameras` were deployed before
    Phase 11 work started.
  - Re-audited deployed Camera RLS/constraints and actual controller, service,
    repository, DTO, Swagger, unit, and E2E behavior. Camera configuration is
    family-scoped; mutations require a current accepted manager; safe active
    metadata reads are limited to accepted manager/adult roles; child, elder,
    pending, rejected, removed, unrelated, and cross-family access is denied.
  - The raw Camera connection URL remains write-only in normal APIs. It is not
    serialized to REST, Socket.IO, FCM, Swagger responses, logs, or exceptions.
    Camera creation/update performs no outbound fetch, DNS lookup, socket, RTSP,
    or HTTP probe. Connectivity remains truthfully `unknown`.
  - Deployed Camera state has forced RLS, no `anon`/`authenticated` SELECT grant,
    all Phase 10 constraints, and zero rows. No Phase 10 runtime fix was required.
- **Phone Management permission and target model**:
  - Only a current accepted `manager` membership in an active family can create,
    mutate, deactivate, or inspect management rules/command history.
  - Only a current accepted `child` in that same active family is eligible for
    management. Adult, elder, pending, rejected, removed, role-changed, inactive-
    family, unrelated, and cross-family targets are rejected on every operation.
  - Device-targeted operations additionally require an active Device owned by the
    target child's authenticated profile. Creator provenance never grants
    permanent authorization after a manager is demoted or removed.
- **Usage telemetry**:
  - Telemetry source is explicitly `managed_device_app`; it is device-reported
    metadata, not cryptographically attested OS truth. The authenticated child,
    route member, family, owned active Device, and current managed-member state
    are verified before persistence.
  - Collected data is limited to app package/name, bounded start/end window,
    duration, target member/Device, and server creation time. SMS/call content,
    contacts, photos, audio, screen contents, keystrokes, and browser history are
    not accepted.
  - `(device_id, client_record_id)` plus a SHA-256 request fingerprint provides
    durable, conflict-aware retry idempotency. Histories use bounded deterministic
    timestamp/UUID cursors and an optional maximum 31-day query window.
  - A child may read current managed-context own usage; current managers may read
    an eligible child's usage. Other family members and former managers cannot.
- **Phone rules**:
  - The existing member-scoped model is retained as one effective policy per
    family/member. Supported structured intent is a 1-1440 minute daily limit and
    an optional paired `HH:mm` bedtime window. Arbitrary scripts/JSON policies are
    not accepted.
  - DELETE performs soft deactivation. PATCH allowlists policy fields and active
    state; it cannot retarget family/member, replace creator, or control server
    timestamps. Current manager and child eligibility are rechecked on mutation.
  - `enforcementStatus=device_enforcement_pending` truthfully distinguishes
    persisted policy intent from real Android/iOS enforcement.
- **Phone commands and transport**:
  - Supported backend command intents are `lock`, `ring`, and bounded `warning`.
    These are persisted requests, not claims that an OS operation succeeded.
  - `(created_by, client_request_id)` plus a request fingerprint, serializable
    transaction retry, and transaction advisory lock provide concurrent-safe
    idempotency. Command provenance and target are immutable.
  - Exact durable states are `pending`, `sent`, `completed`, and `failed`.
    `pending` means committed/pollable; `sent` means FCM accepted a wake-up;
    `completed`/`failed` require an authenticated owner of the exact active target
    Device to ACK actual execution. FCM or Socket delivery never completes a
    command. Repeated identical terminal ACK is safe; conflicting terminal ACK is
    rejected.
  - After command commit, `phone_command.created` is emitted only to the target
    user's private room. FCM contains only `type` and `commandId` plus generic
    wake-up text. No Notification row is created because PhoneCommand is the
    command queue/source of truth.
  - Socket/FCM failure leaves the command durable and pending for polling. A
    permanent invalid-token result clears only the matching token and never
    deactivates the Device or removes the command.
- **Migration**:
  - Created but did not deploy
    `20260901090000_phase11_phone_management`.
  - Before creation, deployed legacy tables contained zero PhoneUsageLog,
    PhoneRule, and PhoneCommand rows. The migration adds idempotency/provenance,
    target consistency triggers, command state transition guards, checks,
    history indexes, restrictive foreign keys, and forced backend-only RLS.
  - Deployment deliberately stops for manual review if incompatible legacy rows
    appear instead of guessing their missing target provenance. It contains no
    table/schema/column drop, truncate, delete, table recreation, or RLS weakening.
- **Device-side boundary and limitations**:
  - Phone Management backend = IMPLEMENTED. Phone command transport = IMPLEMENTED.
    Phone command execution is confirmed only after Device ACK.
  - No Flutter/mobile source exists in this workspace. Android enforcement = NOT
    VERIFIED. iOS enforcement = NOT VERIFIED. No MDM/provider or fake platform
    capability was introduced.
  - Phone sensor fall AI = DEFERRED. Camera fall AI = DEFERRED. Fall Detection
    Backend = DEFERRED. Camera secure streaming = DEFERRED. Automatic fall-to-SOS
    remains NOT IMPLEMENTED.
- **Verification**:
  - Prisma validate PASS; Prisma generate PASS; lint PASS with zero warnings;
    TypeScript typecheck PASS; build PASS.
  - Unit: 70 suites / 376 tests PASS. Phase 11 focused unit: 5 suites / 32
    tests PASS.
  - E2E: 11 suites / 66 tests PASS. Phase 11 focused E2E: 1 suite / 6 tests
    PASS.
  - Live Supabase security regression: 1 suite / 11 tests PASS.
  - Final Prisma status finds 13 migrations with only
    `20260901090000_phase11_phone_management` pending, as required for manual
    review/deployment.

---

## [Phase 11 Final Audit + Phase 12] - Chat / Messaging

- **Date**: 2026-09-01
- **Database gate and Phase 11 audit**:
  - Confirmed all thirteen migrations through
    `20260901090000_phase11_phone_management` were deployed before Phase 12.
    The deployed database was up to date and legacy Conversation,
    ConversationMember, and Message tables each contained zero rows.
  - Re-audited command creation, private transport, polling, exact Device ACK,
    current family/role/Device authorization, rule visibility, telemetry scope,
    and enforcement truthfulness. FCM/Socket success never marks execution
    complete; only the authenticated owner of the exact active target Device can
    ACK. Former managers, role-changed children, removed members, stale rules,
    and inactive Devices are revalidated and denied. No Phase 11 runtime fix was
    required; an explicit same-user/different-Device ACK regression was added.
- **Chat permission and conversation model**:
  - Direct conversations are family scoped and canonicalized by sorted participant
    user IDs. `UNIQUE(family_id, direct_key)`, a transaction advisory lock,
    serializable isolation, and bounded retry provide concurrent-safe get-or-create.
  - Current accepted members of an active family may create direct conversations.
    Only a current accepted family manager may create a group or add/remove group
    participants. Every target is resolved from a FamilyMember ID in that family.
  - ConversationMember lifecycle is soft (`isActive`, `joinedAt`, `removedAt`).
    Removed conversation members, removed/rejected/pending family members, inactive
    families, unrelated users, and cross-family targets immediately lose list,
    detail, history, send, read-cursor, realtime-room, and notification eligibility.
    Re-added group members start at the current tail and cannot read messages from
    before their new join time.
- **Messages, idempotency, ordering, and read state**:
  - Phase 12 accepts strict text-only messages of 1-4000 trimmed characters.
    Sender, recipients, timestamps, type, media, status, and ownership are
    server-controlled; media/location/system messages remain deferred.
  - `(conversation_id, sender_id, client_message_id)` plus a SHA-256 request
    fingerprint is the durable conflict-aware retry key. A transaction advisory
    lock, serializable isolation, unique constraint, and bounded P2002/P2034 retry
    prevent concurrent duplicates. Ordering and cursors use `(createdAt, id)`.
  - Each active ConversationMember stores one nullable last-read Message/time
    tuple. The database verifies same-conversation provenance and prevents cursor
    regression. Unread counts exclude own messages, honor join boundaries, and
    use set-based SQL for conversation lists; no per-message receipt table or N+1
    unread query was added.
- **Realtime and Notification / FCM delivery**:
  - Message persistence commits before delivery. `message.created` is emitted
    only to individually resolved current recipients through `user:{userId}`
    rooms. No broad family or conversation broadcast is used. Legacy `chat:*`
    room joins now also require an active ConversationMember plus current accepted
    membership in the active conversation family.
  - The reusable Notifications domain creates at most one `message` Notification
    per recipient/source Message and up to one NotificationDelivery per active
    token Device. Push bodies are generic and contain no message body, family
    roster, token, installation ID, Auth metadata, or secret. Socket/FCM failure
    cannot roll back or delete Message/Notification state.
- **Migration**:
  - Created but did not deploy `20260901100000_phase12_chat_messaging`.
  - Because the inspected deployed legacy chat tables are empty, the migration
    deliberately aborts if any legacy rows appear before deployment rather than
    guessing family, actor, or idempotency provenance. It adds direct uniqueness,
    message idempotency/order indexes, lifecycle/read state, authorization/read
    triggers, restrictive foreign keys, Notification source integrity, and forced
    backend-only RLS.
  - It contains controlled `DROP INDEX IF EXISTS` statements only to replace two
    legacy indexes with stronger ordered/scoped indexes. It contains no table,
    schema, or column drop; no truncate/delete; no table recreation; and no RLS
    weakening. Manual review is required before `npx prisma migrate deploy`.
- **Explicit deferrals**:
  - Typing and presence = DEFERRED. Media/location messages = DEFERRED. Voice and
    video calls = NOT IMPLEMENTED. Phone sensor fall AI and Camera fall AI remain
    DEFERRED. No Phase 13 functionality was implemented.
- **Verification**:
  - Prisma validate PASS; Prisma generate PASS; lint PASS with zero warnings;
    TypeScript typecheck PASS; build PASS.
  - Unit: 75 suites / 418 tests PASS. Phase 12 focused unit: 6 suites / 52 tests
    PASS.
  - E2E: 12 suites / 72 tests PASS. Phase 12 focused E2E: 1 suite / 6 tests PASS.
  - Live Supabase security regression: 1 suite / 11 tests PASS.
  - Final Prisma status finds 14 migrations with only
    `20260901100000_phase12_chat_messaging` pending, as required for manual review.

---

## [Phase 12 Final Audit + Phase 13] - Calls / Signaling

- **Date**: 2026-09-01
- **Database gate and Phase 12 audit**:
  - Confirmed all fourteen migrations through
    `20260901100000_phase12_chat_messaging` were deployed before Phase 13. Prisma
    reported the database up to date. Deployed Conversation, ConversationMember,
    Message, and legacy CallLog tables each contained zero rows at inspection.
  - Re-audited direct canonical identity/concurrency, group permissions, current
    Family/Conversation revocation, text-only sender-derived Message persistence,
    idempotency/fingerprints, ordered join-bounded history, per-user monotonic
    read cursors, set-based unread aggregation, private current-recipient realtime,
    Notification revalidation/idempotency/fanout, FCM isolation, RLS, Zod, Swagger,
    tests, and documentation. No Phase 12 runtime fix was required.
- **Call scope, participant authorization, and history**:
  - The existing `call_logs` table is evolved into the single durable Call session
    and history domain. Phase 13 supports only one-to-one `voice` and `video`
    invitations associated with a current direct Conversation. Caller identity is
    derived from Supabase authentication; the callee is the other current accepted
    Conversation participant. Group Calls and self-Calls are rejected.
  - Creation rechecks active Family, both accepted FamilyMembers, both active
    ConversationMembers, direct type, exact participant count, and conversation/
    family consistency. Cross-user, cross-family, stale-member, and UUID-substitution
    access is denied.
  - Personal history/detail is durably scoped to caller or callee and remains
    readable after later Family removal. New Calls, acceptance/rejection, and new
    signaling require current authorization. Caller cancellation and either-party
    end remain available as safe terminal cleanup after revocation.
- **Idempotency, busy policy, lifecycle, and timeout**:
  - `(caller_id, client_request_id)` plus SHA-256 of Conversation/type provides
    durable conflict-aware initiation idempotency. Serializable transactions,
    request/participant advisory locks, uniqueness, and bounded serialization retry
    prevent concurrent duplicates.
  - A small `call_active_participants` table has a unique `user_id`, providing a
    race-safe technical policy of at most one ringing/accepted Call per user. Its
    rows are released by a database trigger on terminal transition. Busy conflicts
    reveal no unrelated Call details.
  - Exact states are `ringing`, `accepted`, `rejected`, `cancelled`, `missed`, and
    `ended`. Allowed transitions are ringing to accepted/rejected/cancelled/missed,
    and accepted to ended. Explicit actor rules apply; repeated identical actions
    are side-effect-free and conflicting transitions fail.
  - Ring timeout is a configurable technical default of 45 seconds through
    `CALL_RING_TIMEOUT_SECONDS` (15-300). An indexed, bounded 15-second in-process
    sweep performs DB-conditional/advisory-locked missed transitions, so state is
    restart-safe and multi-instance duplicate-resistant without a broker.
  - Derived duration is explicitly named signaling-session duration and uses only
    server-controlled accepted/terminal timestamps. It is not verified talk-time.
- **Notification, FCM, realtime, and signaling**:
  - A new Call creates one durable `call_incoming` Notification for the callee and
    up to one delivery row per active token Device. Source uniqueness prevents
    duplicates. Current Call state and both participants' current authorization are
    revalidated after Call commit. Push content is generic and never contains SDP,
    ICE, tokens, credentials, installation IDs, or private family data.
  - FCM is wake-up transport only. Success leaves Call state `ringing`; failure
    cannot delete or transition Call/Notification state. Lifecycle events are
    emitted after durable transition only to individually revalidated caller/callee
    private user rooms.
  - `call.signal` relays only strict `offer`, `answer`, and `ice_candidate` payloads
    to the server-derived opposite participant. SDP is bounded to 16 KiB, ICE text
    to 2 KiB, and a technical 120-event/socket/60-second limit applies. Current
    participant, Family, Conversation, Call state, and actor/signal role are checked
    for every signal. SDP/ICE is not persisted, logged, pushed, notified, or exposed
    in REST history.
- **Media boundary and deferrals**:
  - Call session backend, lifecycle, history, incoming FCM, and WebRTC signaling
    relay = IMPLEMENTED. NestJS audio/video transport = NO. Actual WebRTC voice and
    video = NOT VERIFIED. TURN infrastructure and credentials = NOT IMPLEMENTED.
  - Revocation stops new backend signaling but cannot itself terminate an already
    established peer-to-peer media path; client compliance is required.
  - Group Calls = DEFERRED. Call recording and screen sharing = NOT IMPLEMENTED.
    Phone sensor and Camera fall AI remain DEFERRED. No Phase 14 work was added.
- **Migration**:
  - Created but did not deploy `20260901110000_phase13_calls_signaling`.
  - It aborts if legacy CallLog rows appear before deployment, adds Call provenance,
    idempotency, lifecycle timestamps/checks/triggers, direct-participant integrity,
    active-participant busy locks, history/expiry indexes, Notification source
    integrity, restrictive foreign keys, and forced backend-only RLS.
  - Controlled legacy FK/index replacement is present. A trigger contains a domain
    lifecycle `DELETE` only for ephemeral active-participant lock rows on terminal
    Calls; there is no migration-time data cleanup, table/schema/column drop,
    truncate, table recreation, or RLS weakening.
- **Verification**:
  - Prisma validate/generate PASS; lint PASS; typecheck PASS; build PASS.
  - Unit: 81 suites / 481 tests PASS. Phase 13 focused: 7 suites / 66 tests PASS.
  - E2E: 13 suites / 80 tests PASS. Phase 13 focused: 1 suite / 8 tests PASS.
  - Socket signaling: 1 suite / 5 Phase 13 signaling tests PASS.
  - Live Supabase security regression: 1 suite / 11 tests PASS.
  - Final Prisma status finds 15 migrations with only
    `20260901110000_phase13_calls_signaling` pending for manual review.

---

## [Phase 13 Final Audit + Phase 14] - Daily Status / Daily Report

- **Date**: 2026-09-02
- **Database gate and Phase 13 audit**:
  - Confirmed all fifteen migrations through
    `20260901110000_phase13_calls_signaling` were deployed before Phase 14 and
    Prisma reported the database up to date.
  - Re-audited Call actor derivation, direct-participant authorization, durable
    initiation idempotency, busy locks, lifecycle transitions, timeout/accept
    concurrency, FCM state isolation, notification uniqueness, private realtime,
    per-signal authorization, no SDP/ICE persistence, and media truthfulness.
    No Phase 13 runtime fix was required. Regression coverage now explicitly
    checks all terminal busy-lock releases and the timeout-versus-accept race.
- **Report identity, eligibility, and time boundary**:
  - A report is anchored to one active Family and one accepted `child` or `elder`
    FamilyMember, with immutable family/member/subject provenance. Adults and
    managers are not scheduled as subjects.
  - The canonical unique context is `(familyId, subjectUserId, reportDate,
    timezone)`. Report dates use an explicit IANA timezone and the DST-aware
    half-open interval `[local midnight, next local midnight)`.
- **Deterministic sources and non-AI boundary**:
  - Included stored facts are location count/latest time without coordinates,
    geofence enter/exit counts, SOS status counts, reminder occurrence/processed/
    missed counts, and child-only device-reported phone usage totals/top apps.
  - Calls, chat, fall events, camera data, narrative generation, diagnosis,
    recommendation, risk or safety score, and AI inference are excluded. Missing
    facts never become an unsupported safe/healthy claim.
- **Privacy and historical access**:
  - Subjects can read their own persisted history after later removal. Another
    user requires a current accepted manager relationship in the same active
    family and a still-eligible subject.
  - Manager location/geofence sections require current global and both relevant
    per-family location-sharing permissions. Manager SOS summaries require
    durable SOS-recipient provenance. Restricted sections return only an
    availability marker; unrelated, pending, rejected, removed, adult, former
    manager, and cross-family access is denied.
- **Generation and snapshot policy**:
  - A bounded in-process scheduler finds missing previous-local-day reports after
    a configurable grace interval. Serializable transactions, transaction-level
    advisory locking, a durable unique key, and bounded conflict retries make
    generation restart- and multi-instance-safe.
  - Finalized reports are immutable and have no public create/update/regenerate
    endpoint. Late source data does not silently change an existing snapshot.
    Generation failure leaves no fabricated report.
- **Transport boundary**:
  - Phase 14 adds no Notification, FCM, or Socket.IO workflow. Reports remain
    pull-based persisted application data with strict safe DTOs and bounded
    cursor history.
- **Migration**:
  - Created but did not deploy
    `20260902120000_phase14_daily_status_reports`.
  - The migration aborts if unexpected legacy rows appear, adds canonical report
    identity/window/JSON schema fields, restrictive provenance foreign keys,
    eligibility/window/immutability checks and triggers, ordered indexes, and
    forced backend-only RLS. It replaces only controlled legacy constraints and
    indexes and contains no table/schema/column drop, truncate, row cleanup,
    table recreation, or RLS weakening. Manual review is required before
    `npx prisma migrate deploy`.
- **Deferred status**:
  - Phone sensor fall AI and Camera fall AI remain DEFERRED. AI Daily Report and
    generated Daily Report narrative are NOT IMPLEMENTED. No later phase was
    implemented.
- **Verification**:
  - Prisma validate/generate PASS; lint PASS with zero warnings; typecheck PASS;
    build PASS.
  - Unit: 87 suites / 510 tests PASS. Phase 14 focused unit: 6 suites / 28 tests
    PASS.
  - E2E: 14 suites / 87 tests PASS. Phase 14 focused E2E: 1 suite / 7 tests PASS.
  - Live Supabase security regression: 1 suite / 11 tests PASS.
  - Final Prisma status finds 16 migrations with only
    `20260902120000_phase14_daily_status_reports` pending for required manual
    review and deployment.

---

## [Phase 15] - Final Backend Audit / Integration Hardening

- **Date**: 2026-09-02
- **Database and migration gate**:
  - Confirmed all 16 Prisma migrations through Phase 14 are deployed and the
    database schema is up to date. Prisma validation and generation pass.
  - Live read-only inspection confirms all 31 expected application tables are
    present, all 31 have enabled and forced RLS, and neither `anon` nor
    `authenticated` has a direct whole-table grant. Six policies, 39 public
    triggers, and Prisma migration history are present.
  - No migration was created or deployed during this audit.
- **Security and correctness fixes**:
  - Realtime family/member room admission now requires both accepted membership
    and an active Family. High-sensitivity producers continue to resolve current
    recipients and emit only to private `user:{userId}` rooms.
  - Location and geofence realtime delivery failures are isolated after commit;
    Socket transport failure no longer converts committed domain writes into an
    HTTP failure that encourages unsafe mobile retries.
  - The response interceptor now preserves root `data` for every service list
    result, including lists with non-pagination metadata and lists without a
    pagination object. This removes unintended `data.data` contracts for
    Reminder upcoming and Chat members. Unit and E2E regressions cover both.
- **Architecture and operational hardening**:
  - Health readiness database access now follows Controller -> Service ->
    Repository -> PrismaService rather than querying Prisma in the service.
  - Nest shutdown hooks are enabled so Prisma and scheduler lifecycle cleanup
    execute on process signals.
  - Chat Swagger success responses now define concrete participant, message,
    conversation, cursor, read-state, and unread-count schemas.
  - `prisma:safe-read` now verifies the exact expected table set, forced RLS,
    and absence of direct client table grants in addition to connectivity.
- **Architecture and privacy decision**:
  - Production application data uses repositories and PrismaService; Supabase is
    limited to Auth/Admin Auth. Firebase SDK imports remain confined to the
    Firebase infrastructure adapter. Notification FCM and PhoneCommand wake-up
    transport do not control durable domain state.
  - Location/geofence sharing, membership and role revocation, SOS provenance,
    Conversation/Call current access, device ownership, and Daily Status section
    redaction were re-audited with no unresolved authorization/privacy blocker.
- **Handoff and limitations**:
  - Added `docs/flutter-integration-contract.md` for REST envelopes, auth,
    pagination, idempotency, Socket events, FCM types, state machines, privacy,
    time semantics, and explicit deferrals.
  - Added `docs/technical-debt.md`. Notable accepted debt includes no durable FCM
    retry worker, plaintext-at-rest Camera URLs, in-process schedulers,
    deployment observability/retention work, and transitive dependency advisories
    whose automatic remedies are incompatible downgrades/major changes.
  - Phone sensor fall AI, Camera fall AI, automatic fall-to-SOS, Camera streaming,
    TURN, media relay, and mobile OS enforcement remain deferred/unverified.
- **Final verification**:
  - Prisma migrate status PASS (16 found, 0 pending); validate PASS; generate
    PASS; lint PASS; typecheck PASS; build PASS; read-only DB/RLS audit PASS.
  - Unit: 87 suites / 514 tests PASS.
  - E2E: 14 suites / 89 tests PASS.
  - Live Supabase security regression: 1 suite / 11 tests PASS.
