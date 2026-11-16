# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SafeNet backend: NestJS 11 + TypeScript (strict) API for the SafeNet Flutter family-safety app. Node.js 22+.

`AGENTS.md` (this directory) is the binding engineering contract — read it before changing code. The parent `../AGENTS.md` covers the Flutter client, not this backend. `docs/flutter-integration-contract.md` is the authoritative API handoff to Flutter; `docs/technical-debt.md` lists accepted limitations and deferred work (fall AI, camera streaming, TURN, durable FCM retry).

## Commands

```bash
npm run start:dev            # watch mode; API at /api/v1, Swagger at /api/docs
npm run lint:check           # lint without mutation (lint:fix mutates)
npm run typecheck            # tsc --noEmit
npm test                     # unit tests: src/**/*.spec.ts
npm run test:e2e             # test/*.e2e-spec.ts (config: test/jest-e2e.json)
npm run build                # nest build — must pass before a phase is done
```

Single test:

```bash
npx jest src/modules/sos/sos.service.spec.ts
npx jest src/modules/sos -t "trigger"
npx jest --config ./test/jest-e2e.json test/sos.e2e-spec.ts
```

Live Supabase integration suites (`test:integration:*`, config `test/jest-supabase-integration.json`) are opt-in: they need `RUN_LIVE_SUPABASE_INTEGRATION=true` plus dedicated test-project variables from `.env.example`, otherwise they report `SKIPPED`. Only run against a test/staging project.

Prisma:

```bash
npm run prisma:validate
npm run prisma:generate      # regenerates src/generated/prisma (committed; never hand-edit)
npm run prisma:migrate:status
npm run prisma:safe-read     # builds, then read-only checks of expected tables via dist/
```

## Architecture

### Request pipeline (wired globally in `src/app.module.ts`)

- `SupabaseAuthGuard` is a global `APP_GUARD`: every route requires `Authorization: Bearer <Supabase access token>` unless marked `@Public()` (`src/common/decorators/public.decorator.ts`). Get the caller via `@CurrentUser()`.
- `ThrottlerGuard` is also global (`THROTTLE_TTL` / `THROTTLE_LIMIT`).
- Interceptors: `RequestIdInterceptor` → `LoggingInterceptor` → `ResponseTransformInterceptor`. The transform wraps return values into `{ success, message, data }`. If a service returns an object with a `data` key (e.g. `{ data, pagination }`), it is spread at the envelope root. Return nothing for `204`.
- `GlobalExceptionFilter` produces the `{ success: false, error: { code, message, details } }` shape. Throw `AppError` subclasses from `src/common/errors/app.error.ts` with codes from `src/common/constants/error-codes.ts`; don't hand-build error bodies. User-facing messages are Vietnamese.
- Validation: Zod schemas in each module's `dto/`, applied via `ZodValidationPipe` (`src/common/pipes/zod-validation.pipe.ts`). Zod failures map to `400 VALIDATION_ERROR`.
- Env is validated at startup (`src/config/env.validation.ts`); production fails fast without Supabase keys and a non-wildcard `CORS_ORIGINS`.

### Data access

`Controller → Service → <module>.repository.ts → PrismaService → Supabase PostgreSQL`.

- `PrismaService` (`src/infrastructure/database`) uses `@prisma/adapter-pg` over `DATABASE_URL`. Import Prisma types from `src/generated/prisma/client`.
- `SupabaseService` is for Auth/admin-auth only (used by `modules/auth`). Never use `supabase.from(...)` for application tables.
- Multi-write operations use `prisma.$transaction` inside repositories. Several repositories use serializable transactions with bounded retry constants (e.g. `SOS_TRANSACTION_RETRY_LIMIT`).
- Repositories define explicit `select` projections (`safe*Select`) so responses never leak FCM tokens, installation IDs, camera URLs, etc. Keep that pattern.
- Backend imports use relative paths (no path aliases).

### Module layout

Each `src/modules/<domain>/` follows: `*.module.ts`, thin `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `dto/`, `*.constants.ts`, `*.swagger.ts` (Swagger decorators kept out of controllers), and specs including `*-migration.spec.ts`, which assert on the migration SQL.

Cross-cutting services reused by other modules:

- `families/family-access.service.ts` — family membership/role authorization. Only `accepted` memberships grant access; roles (`manager|adult|child|elder`) are per family, not global.
- `notifications` — persistent notification + `NotificationDelivery` records; FCM via `infrastructure/firebase`. FCM reports `disabled` when Firebase isn't configured.
- `infrastructure/realtime` — Socket.IO gateway. The handshake requires a Supabase token. Room access (`user:`, `family:`, `member:`, `chat:`) is checked in `realtime-room-authorization.service.ts`. Sensitive events go to private `user:{id}` rooms with recipients resolved fresh from the DB.

Safety-critical ordering (SOS, geofence events, notifications): persist and commit first, then emit realtime/FCM. A delivery failure must not roll back the committed event.

In-process bounded pollers (no queue): `reminders/reminder-scheduler.service.ts`, `calls/call-scheduler.service.ts`, and the daily-status scheduler. They rely on DB uniqueness and advisory locks.

### Migrations

- `prisma/migrations/` owns all future schema changes. `0_init` is an introspected baseline already marked applied — never execute it, and never run `prisma migrate dev` against the shared DB.
- `supabase/migrations/` is historical audit input only.
- RLS, policies, grants/revokes, functions, and triggers live as custom SQL inside Prisma migrations. Supabase owns the `auth` schema. A DB trigger creates `profiles`, `user_settings`, and `biometric_settings` on signup — don't add a second creation path.
- After editing `prisma/schema.prisma`, add a forward migration and run `prisma:generate`.

### Scope boundaries

Fall-detection AI (phone sensor and camera), automatic fall-to-SOS, camera streaming, and media transport for calls are not implemented. Don't invent thresholds or claim these exist. `fall_events` must stay compatible with future phone and camera sources.
