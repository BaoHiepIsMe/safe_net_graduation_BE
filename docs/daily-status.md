# Phase 14 Daily Status / Daily Report

Phase 14 produces immutable, persisted, deterministic summaries of facts that
already exist in SafeNet. It does not use AI, generate prose, calculate a safety
score, infer health or wellbeing, or accept client-supplied report content.

## Subject and authorization policy

The canonical subject is the accepted `child` or `elder` FamilyMember captured
by `(familyId, memberId, subjectUserId)`. The family must be active when a report
is generated. Adults and managers are not scheduled as report subjects.

An authenticated subject may list and read their own persisted reports,
including reports created before a later family removal. A manager may read a
subject report only while both are accepted members of the same active family,
the viewer is currently a manager, and the subject remains eligible. Pending,
rejected, removed, unrelated, and cross-family users are denied. Historical
access is never reconstructed from guessed UUIDs.

Location and geofence sections are visible to a current manager only when the
subject's global location sharing and both relevant per-family sharing settings
allow it. SOS facts are visible only when durable `sos_recipients` provenance
shows that the viewer was authorized for every SOS summarized in the interval.
Restricted sections expose an availability marker, not hidden counts.

## Date and snapshot semantics

Reports use an explicit IANA timezone and local calendar date. Their immutable
window is `[local midnight, next local midnight)`, converted to UTC with DST
awareness. The default timezone is configured by
`DAILY_STATUS_DEFAULT_TIMEZONE`; generation becomes due after the technical
`DAILY_STATUS_GENERATION_GRACE_MINUTES` delay.

The scheduler scans a bounded batch of missing previous-local-day reports every
15 minutes. Serializable transactions, an advisory lock, and the durable unique
key `(familyId, subjectUserId, reportDate, timezone)` ensure restart-safe and
multi-instance-safe creation. A report is never silently regenerated. Facts
arriving after finalization remain in their source tables but do not mutate the
snapshot.

## Included facts

- Location: record count and last recorded time only; no coordinate is stored in
  the report summary.
- Geofence: persisted enter/exit event counts and an explicit availability state.
- SOS: total and status counts; manager visibility additionally requires durable
  incident-recipient provenance.
- Reminders: scheduled occurrence, notification-processed, and missed counts.
  No medication-taken/completed claim is inferred.
- Phone usage: device-reported total duration and up to five top applications,
  only for child subjects.

Calls, chat/messages, fall events, camera data, free-form narrative, diagnosis,
risk score, and other inferred facts are excluded. Missing data is reported as
unavailable or as a factual empty source result; it is never converted into a
claim that the member was safe, healthy, or inactive.

## API and delivery boundary

- `GET /api/v1/daily-status` lists the authenticated subject's reports with
  bounded `(reportDate, id)` cursor pagination and minimized overview DTOs.
- `GET /api/v1/daily-status/:reportId` returns one authorized detail.
- `GET /api/v1/families/:familyId/members/:memberId/daily-status` lists reports
  for the subject or a currently authorized manager.

There is no public create, update, regenerate, or fact-submission route. Phase 14
does not create Notifications, send FCM, or emit Socket.IO events. The database
record is the source of truth and API DTOs never expose coordinates, tokens,
installation IDs, provider data, or raw Prisma records.
