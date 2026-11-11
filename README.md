# SafeNet Backend

> Current data architecture: Controller -> Service -> Repository ->
> PrismaService -> Supabase PostgreSQL. The Supabase JavaScript client is
> restricted to Auth/admin-auth; production application-data access uses Prisma.

NestJS backend for the SafeNet Flutter application. The implemented non-AI
scope includes Auth/Profiles, Families, Devices, Locations, Geofences,
Notifications/FCM, manual SOS, Reminders, Camera Management, Phone Management,
Chat, Calls/Signaling, and deterministic Daily Status reports.

Phone sensor fall AI, camera fall AI, automatic fall-to-SOS, camera streaming,
TURN, media relay, and mobile OS enforcement are explicitly deferred or
unverified. The backend does not claim that these capabilities exist.

The authoritative Flutter handoff is
[`docs/flutter-integration-contract.md`](docs/flutter-integration-contract.md).
Operational limitations and accepted debt are tracked in
[`docs/technical-debt.md`](docs/technical-debt.md). Swagger is available at
`/api/docs`.

## Stack

- Node.js 22+
- NestJS 11 và TypeScript strict
- Supabase Auth và Supabase PostgreSQL
- Zod
- Firebase Admin/FCM
- Socket.IO qua NestJS Gateway
- Swagger/OpenAPI
- Jest và Supertest

## Cài đặt

```bash
npm ci
Copy-Item .env.example .env
```

Điền giá trị thật vào `.env`. Không commit `.env`, service-role key hoặc Firebase private key.

## Biến môi trường

| Variable                          | Mục đích                                                   |
| --------------------------------- | ---------------------------------------------------------- |
| `PORT`                            | Cổng HTTP                                                  |
| `NODE_ENV`                        | `development`, `test`, hoặc `production`                   |
| `API_PREFIX`                      | Prefix, mặc định `api/v1`                                  |
| `CORS_ORIGINS`                    | Allowlist phân tách bằng dấu phẩy; production cấm wildcard |
| `SUPABASE_URL`                    | URL project Supabase                                       |
| `SUPABASE_ANON_KEY`               | Client key dùng cho Supabase Auth operations               |
| `SUPABASE_SERVICE_ROLE_KEY`       | Server-only Supabase Auth admin key                        |
| `SUPABASE_AUTH_TIMEOUT_MS`        | Timeout mỗi request Supabase Auth, mặc định 10000 ms        |
| `FIREBASE_PROJECT_ID`             | Firebase project, optional ở development                   |
| `FIREBASE_CLIENT_EMAIL`           | Firebase service-account email                             |
| `FIREBASE_PRIVATE_KEY`            | Firebase private key, hỗ trợ escaped newline               |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | Global request rate limit                                  |
| `MAX_BODY_SIZE`                   | JSON/urlencoded request limit                              |

Production fail-fast nếu thiếu Supabase URL, anon key, service-role key hoặc CORS allowlist hợp lệ. Khi Firebase không được cấu hình, FCM trả trạng thái `disabled`; không báo delivery thành công giả.

## Chạy và kiểm tra

```bash
npm run start:dev
npm run lint:check
npm run typecheck
npm test
npm run test:e2e
npm run test:integration:supabase
npm run build
npm run start:prod
```

### Live Supabase integration

`test:integration:supabase` is opt-in. Without all dedicated test variables it reports:

```text
SKIPPED - LIVE SUPABASE ENVIRONMENT NOT CONFIGURED
```

Only set `RUN_LIVE_SUPABASE_INTEGRATION=true` against a test/staging Supabase project, with two confirmed test accounts and the signup-test values listed in `.env.example`. The suite checks anonymous denial, own/foreign-row RLS, backend-only table denial, admin access, and creation of all three Phase 1 rows by the deployed signup trigger. Its temporary signup user is deleted during cleanup.

`npm run lint:fix` là lệnh sửa format/lint có mutation. CI nên dùng `lint:check`.

## API và health

- Base API: `/api/v1`
- Swagger UI: `/api/docs`
- Liveness: `GET /api/v1/health/live`
- Readiness: `GET /api/v1/health/ready`

Private endpoints dùng `Authorization: Bearer <Supabase access token>`.

## Supabase architecture

```text
auth.users
  -> database trigger (cùng transaction signup)
  -> public.profiles
  -> public.user_settings
  -> public.biometric_settings
```

Registration uses the server-only Auth admin client to create a confirmed
user with email, phone, and profile metadata (including `role`), without
sending a signup confirmation email. The seven required fields are documented in
[`docs/flutter-integration-contract.md`](docs/flutter-integration-contract.md#registration).
Apply Prisma migrations `20261016090000_registration_profile_fields` and
`20261110090000_profile_registration_role` before enabling the registration contract.
Other Auth calls use the anon/auth client; privileged Auth administration uses
the server-only service-role client. Application data access uses Prisma directly
through `DATABASE_URL`; neither credential replaces authorization in NestJS.

Forward migration `20260819010000_secure_foundation_phase1.sql`:

- bật/force RLS cho application tables;
- revoke quyền `anon` và `authenticated` mặc định;
- chỉ cấp column-level select/update cho row Phase 1 của chính user;
- giữ Phase 2+ tables ở chế độ backend-only đến khi authorization được triển khai.

Forward migration `20260819020000_server_managed_phase1_timestamps.sql` revokes direct client control of `updated_at` and maintains the value with database triggers.

## Prisma workflow

`DATABASE_URL` is the direct PostgreSQL connection used by Prisma. The
introspected `prisma/migrations/0_init` baseline is already recorded as applied;
never execute its SQL against the populated database.

Future database changes belong in `prisma/migrations`. Review pending SQL and
verify it in staging before `prisma migrate deploy`. Custom SQL for RLS,
policies, grants/revokes, functions, and triggers remains in those migrations.
Supabase continues to own the `auth` schema. Historical
`supabase/migrations` files are retained as audit history, not as the future
migration authority.

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:status
npm run prisma:safe-read
```

## Phase 2 Families

Implemented routes:

- `POST /api/v1/families`
- `GET /api/v1/families`
- `GET|PATCH|DELETE /api/v1/families/:familyId`
- `GET /api/v1/families/:familyId/members`
- `GET|PATCH|DELETE /api/v1/families/:familyId/members/:memberId`
- `POST /api/v1/families/:familyId/invitations`
- `GET /api/v1/families/invitations/pending`
- `POST /api/v1/families/invitations/:invitationId/accept`
- `POST /api/v1/families/invitations/:invitationId/reject`

Family creation and initial accepted-manager membership commit in one Prisma
transaction. Roles are family-scoped. Only accepted memberships grant access;
manager actions are checked against the target family. Delete archives the
family rather than physically deleting it. Invitations reuse
`family_members` with `pending -> accepted|rejected`; removed/rejected users
may be invited again.

Invitation push/realtime delivery is not implemented in Phase 2 because the
persistent Notifications/FCM producer domain belongs to Phase 6. Clients fetch
authoritative pending invitations through REST.

## Phase 3 Devices

Implemented authenticated owner-only routes:

- `POST /api/v1/devices`
- `GET /api/v1/devices`
- `GET|PATCH|DELETE /api/v1/devices/:deviceId`
- `POST /api/v1/devices/:deviceId/heartbeat`

Registration is idempotent by a Flutter-generated random UUID installation ID;
FCM tokens are mutable delivery metadata and never device identity. An active
installation cannot be claimed by another account. A token presented by its
current holder is detached from any stale device row before reassignment, and
deactivation clears the token. Normal responses use explicit projections and
never expose FCM tokens or installation IDs.

Heartbeat controls `lastSeenAt` on the server and accepts only optional battery
percentage metadata. Device APIs do not implement family monitoring or accept
location data. Deactivation is soft and idempotent; re-registration by the same
installation reactivates the row.

Forward migration `20260820050000_phase3_device_integrity` adds device identity,
platform, battery, FCM-routing, non-null lifecycle constraints, and `updated_at`
without recreating or deleting the existing table. Review and deploy it after
the pending Phase 2 migration.

Phone sensor fall AI and camera fall AI remain deferred. No inference, sensor
classification, camera processing, or location tracking is part of Phase 3.

## Phase 4 Locations

Implemented authenticated routes:

- `POST /api/v1/devices/:deviceId/locations`
- `GET /api/v1/locations/me/current`
- `GET /api/v1/locations/me/history`
- `GET /api/v1/families/:familyId/locations/current`
- `GET /api/v1/families/:familyId/members/:memberId/location`

Writes derive the user from the verified Supabase token and require the target
device to be owned and active. A serializable transaction appends history,
conditionally advances the per-user current projection, and updates device
last-seen metadata. The PostgreSQL upsert compares `recorded_at` and a stable
location-ID tie breaker, so late or concurrent points remain in history without
moving current state backward.

Current state is one newest point per user across that user's devices. Own
history uses bounded `(recordedAt DESC, id DESC)` cursor pagination. Family Map
returns current locations only when caller and target are accepted members of
the same active family and the target enables both membership-level and global
location sharing. Other users' historical locations remain private.

After a committed current-state change, `location.updated` is emitted only to
the owner's and currently approved family recipients' private user rooms. Raw
models and device secrets are excluded. Normal location updates never send FCM.

Forward migration `20260824060000_phase4_location_integrity` evolves the
existing empty location tables in place, adds user/device provenance, a
per-user current key, capture/receive timestamps, constraints and chronological
indexes. It is not deployed automatically.

Geofences, safe-zone evaluation, SOS, notifications and fall-detection AI are
not part of Phase 4. Phone Fall AI and Camera Fall AI remain deferred.

## Realtime security

Socket handshake phải có Supabase access token. Room rules:

- `user:{id}`: chỉ chính user;
- `family:{id}`: accepted family membership;
- `member:{id}`: target member accepted và caller accepted trong cùng family;
- `chat:{id}`: caller có conversation membership.

Room name malformed hoặc unauthorized đều bị từ chối bằng cùng error contract để không lộ resource existence.

## Project structure

```text
src/common             shared errors, guards, pipes, interceptors, Swagger
src/config             environment and CORS configuration
src/infrastructure     Prisma database, Supabase Auth, Firebase FCM, realtime
src/modules/auth       Supabase Auth API
src/modules/profiles   private profile/settings/biometric API
src/modules/families   family/member/invitation API and family authorization
src/modules/devices    owner-only device registration and lifecycle API
src/modules/locations  trusted location history/current/Family Map API
src/modules/health     liveness/readiness
prisma/migrations      forward-only application database migrations
supabase/migrations    retained historical migration inputs
test                   E2E tests
docs                   implementation plan and log
```
