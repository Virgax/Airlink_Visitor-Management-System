# Phase 1 — slices

Each slice lives in its own worktree and branch, with its own database and port. Schema is frozen in `develop`:
do not edit `prisma/schema.prisma` without coordinating with the integrator (add a note in your final report instead).
Shared dependencies are already installed (`qrcode`, `@zxing/browser`, `nodemailer`, `idb`); do not add others.

| Slice | Branch | DB | Port | Scope |
|---|---|---|---|---|
| A | feat/sites-directory | visitas_a | 3101 | Admin CRUD for sites, gates, areas, visit policies, companies, blacklist; Employee directory (manual CRUD + search), `/api/sync/employees` (HMAC `SYNC_SECRET`), `src/lib/sync/employees.ts` parser (unit-tested), `tools/sync-agent` |
| B | feat/passes | visitas_b | 3102 | Host `/app`: create/list/revoke passes (all kinds, group, recurring), policy evaluation → `pending_approval`; approvals at `/app/approvals`; `/v/<token>` with QR (static + rotating), visitor pre-registration (doc → docHash/last4, phone, plate), NDA acceptance |
| C | feat/guard | visitas_c | 3103 | Kiosk `/guard`: camera scanner (BarcodeDetector + @zxing/browser), `/api/guard/scan` (validatePass + blacklist + consumePassUse + Visit), unannounced visits (host search, pending Visit → `notify`), inside list / check-out / dock states, evacuation list (printable), offline queue (IndexedDB + `scanId`) |
| D | feat/notifications | visitas_d | 3104 | Channels behind `src/lib/notifications/index.ts`: Web Push (VAPID, `PushSubscription`), Teams webhook (Adaptive Card + `/api/teams/action` signed), email (nodemailer, `SMTP_*`); `NotificationPref` + quiet hours; in-app list at `/app/notifications`; host approve/deny for pending visits; cron escalation (`unannouncedTimeoutMin`), `NOTIFY_FAKE=1` |
| E | feat/logs-reports | visitas_e | 3105 | Shift log at `/guard/log` (note/incident/round/handover, photo optional); `/admin/reports` with filters (date, site, gate, kind, host, area, company), CSV export, audit report; `/admin` dashboard counts |

Shared contracts:
- `notify()` in `src/lib/notifications/index.ts` is the only way to send notifications.
- Visits: `status` transitions `pending → approved|denied|timeout`, `approved → inside → left`, carriers `approved → at_dock → left`.
- Every page/action goes through `requireMembership` / `getMembershipOrThrow` and `tenant.siteFilter`.
- UI text in `messages/es.json` + `messages/en.json` under a namespace per slice (`admin.*`, `host.*`, `guard.*`, `notifications.*`, `reports.*`).
