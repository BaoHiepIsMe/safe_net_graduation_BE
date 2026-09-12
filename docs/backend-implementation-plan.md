# SafeNet NestJS Backend Implementation Plan

## 1. Domain Status & Architecture Assessment

| Domain / Capability                     | Status                | Notes / Plan                                                                                                                                                                         |
| --------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Core NestJS Foundation**              | Existing / remediated | Central response/error contract, request ID, sanitized logging, strict endpoint Zod validation, CORS allowlist, Swagger, live/ready health.                                          |
| **Supabase Client & Auth Provider**     | Existing / remediated | Separate anon auth client and explicit service-role admin client; production configuration fails fast.                                                                               |
| **Firebase / FCM Integration**          | Implemented           | Typed outcomes, classified invalid/transient/configuration failures, bounded transient retry, invalid-token cleanup, and no fabricated success when disabled.                        |
| **Realtime Gateway (Socket.IO)**        | Existing / remediated | Auth handshake, DB-backed room authorization, private location/geofence/notification domain events, and shared validated CORS configuration.                                         |
| **Database Migrations**                 | Existing / verified   | All sixteen migrations through Phase 14 are deployed; Prisma reports the database schema up to date.                                                                                |
| **Auth & Profiles (Phase 1)**           | Existing / remediated | Supabase signup rejects provider errors/null users, relies only on the transactional trigger, and exposes own private profile/settings/biometric endpoints.                          |
| **Families & Members (Phase 2)**        | Implemented           | Transactional create + initial manager, accepted-only access, archive lifecycle, member management, email/phone invitations, state transitions, pagination, and family-scoped auth.  |
| **Devices (Phase 3)**                   | Implemented           | Owner-only idempotent registration, safe DTOs, FCM token rotation, battery metadata, server heartbeat, and soft deactivation.                                                        |
| **Locations & Family Map (Phase 4)**    | Implemented           | Owned-active-device ingestion, per-user current projection, out-of-order-safe history, own cursor history, privacy-filtered Family Map, and safe realtime.                           |
| **Geofences (Phase 5)**                 | Implemented           | Manager lifecycle, accepted-member assignment, privacy-aware circular evaluation, durable duplicate-safe enter/exit state/events, history, and private-room realtime.                |
| **Notifications / FCM (Phase 6)**       | Implemented / audited | Persistent owner-scoped notification APIs, durable source idempotency, private realtime emission, and audited per-device FCM fanout for geofence and SOS producers.                  |
| **SOS System (Phase 7)**                | Implemented           | Private contacts, manual idempotent SOS activation, immutable current-location snapshots, durable recipients, notification integration, protected history/detail, and lifecycle.     |
| **Fall Detection Workflow (Phase 8)**   | Deferred              | DEFERRED — WAITING FOR AI MODEL and its real output contract. No inference, threshold, endpoint, or automatic fall-to-SOS path is implemented.                                       |
| **Reminders (Phase 9)**                 | Implemented / audited | Current-membership visibility, execution-time target revocation, structured timezone recurrence, durable occurrence/log idempotency, bounded technical catch-up, and Notifications.  |
| **Cameras (Phase 10)**                  | Implemented           | Family-scoped safe metadata CRUD, manager-only lifecycle/configuration, adult read access, write-only connection URL, unknown connectivity, and no streaming/AI claims.              |
| **Phone Management (Phase 11)**         | Implemented           | Device-reported idempotent usage, manager-scoped child policy intent, durable `lock`/`ring`/`warning` commands, private transport, polling, and target-Device ACK lifecycle.         |
| **Conversations & Messages (Phase 12)** | Implemented           | Family-scoped direct/group chat, durable message idempotency, current-membership revocation, per-user conversation read cursors, private realtime, and Notification/FCM fanout.      |
| **Calls (Phase 13)**                    | Implemented           | One-to-one direct-family Call sessions, truthful lifecycle, durable busy/idempotency controls, history, incoming Notifications/FCM, and private ephemeral WebRTC signaling.          |
| **Daily Status Reports (Phase 14)**     | Implemented           | Immutable, deterministic non-AI snapshots for eligible child/elder members from authorized persisted facts, with privacy-redacted subject/manager reads and restart-safe generation. |
| **Final Backend Audit / Hardening**     | Complete              | Cross-domain authorization, transport isolation, response-envelope consistency, Swagger contracts, forced RLS, migrations, tests, and Flutter handoff documentation were audited.    |
| **Upload / Media Support**              | Deferred              | No upload/media backend is claimed by the current graduation-project scope. Any future implementation requires a separately approved design and security review.                      |

---

## 2. Phase Breakdown and Verification Gates

Every phase will follow the mandatory cycle:

1. Migrations & Schema checks
2. Modules, Controllers, Services, Repositories
3. Zod validation schemas
4. Auth & Authorization enforcement
5. Business rules & safety workflows
6. Meaningful unit/integration/E2E tests
7. Swagger documentation annotations
8. Verification (`lint`, `test`, `build`)
9. Log update in `docs/backend-implementation-log.md`

## 3. Deferred Phase 8+ Schema Concerns

These concerns remain for their owning later phases:

- enforce same-family relationships for fall events;
- add source/device/camera consistency constraints for fall events;
- add transaction boundaries for fall workflows;
- implement scoped idempotency and request-hash conflict handling for later producers;
- review missing foreign-key and chronological indexes per domain.
