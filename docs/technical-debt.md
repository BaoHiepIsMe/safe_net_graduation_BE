# SafeNet Backend Technical Debt Register

No item below is an unresolved Critical, High, or authorization/privacy/
integrity Medium blocker for the audited non-AI Flutter integration scope.

| Issue | Severity | Classification | Blocks Flutter | Recommended future action |
| --- | --- | --- | --- | --- |
| FCM has bounded inline attempts but no durable background retry worker. | Medium | Accepted MVP limitation | No | Add an outbox/worker with backoff, observability, and idempotent claiming if guaranteed eventual delivery becomes a requirement. |
| Camera connection URLs are write-only in APIs but plaintext at rest. | Medium | Accepted MVP limitation | No | Add KMS-backed application field encryption and key rotation before real production camera credentials are stored. |
| Camera streaming and playback are absent. | N/A | Deferred product work | No | Design transport, credential exchange, and authorization separately. |
| TURN infrastructure and credential issuance are absent. | N/A | Deferred product work | No | Add an approved short-lived TURN credential service when deployment topology is known. |
| Actual WebRTC voice/video interoperability is not verified. | Medium | Deferred product work | No | Run Flutter device/network interoperability, reconnect, and revocation tests. |
| Android and iOS phone-policy enforcement is not verified. | Medium | Deferred product work | No | Validate native privilege, execution, ACK, offline, and uninstall behavior on real devices. |
| Phone sensor and camera fall AI are absent; no automatic fall-to-SOS exists. | N/A | Deferred product work | No | Wait for an approved real model/output contract and perform a separate safety/security phase. |
| Reminder scheduling is an in-process bounded poller. | Low | Accepted MVP limitation | No | Move to a supervised worker/queue if availability or scale requires it; retain DB uniqueness and locks. |
| Call timeout scheduling is an in-process bounded poller. | Low | Accepted MVP limitation | No | Use a supervised delayed-job worker at scale; keep conditional transitions and durable participant locks. |
| Daily Status scheduling is an in-process bounded poller. | Low | Accepted MVP limitation | No | Use an external scheduler/worker for stronger execution SLAs; preserve advisory locks and canonical uniqueness. |
| A production data-retention/deletion schedule is not finalized. | Medium | Accepted MVP limitation | No | Approve legal/product retention periods, deletion/anonymization jobs, backups, and audit requirements before public production. |
| Production metrics, tracing, alert routing, and log aggregation are deployment-specific and not configured in this repository. | Medium | Accepted MVP limitation | No | Define SLOs and add deployment monitoring for DB pool, scheduler lag, notification failures, and error rate. |
| Sensitive realtime broad-room memberships are not forcibly evicted mid-connection after revocation. Current sensitive producers use fresh DB recipient resolution and private user rooms. | Low | Defense in depth | No | Add revocation-driven socket eviction if broad rooms later carry sensitive events. |
| Security response headers depend on the deployment proxy; no Helmet middleware is installed. | Low | Deployment hardening | No | Configure equivalent headers at the ingress or add and regression-test Helmet before public Internet exposure. |
| `npm audit --omit=dev` reports four High and six Moderate transitive advisories. High paths are Prisma CLI/config (`deepmerge-ts`, `mysql2`, with MySQL unused); Moderate paths are Firebase transitive storage/retry/gaxios/UUID code while this app uses FCM only. Suggested automatic fixes are incompatible major changes/downgrades. | Medium | Dependency maintenance | No | Track upstream compatible releases, run reachability-focused security review, upgrade in a controlled branch, and rerun all gates. |
