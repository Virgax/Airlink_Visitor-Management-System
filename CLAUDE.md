# CLAUDE.md — Airlink Visitas (visitor management for Airlink Distribution DR)

## Product
Visitor control for an electronics refurbishment plant in Santo Domingo. Hosts are employees; visitors are
vendors, contractors, carriers, client auditors (Assurant/AT&T/Samsung), candidates and couriers. Security/reception
validates signed QR passes at a kiosk, prints badges, keeps an evacuation list and an auditable log.
Full brief: `docs/PLAN.md`.

## Conventions
- UI text in Spanish (DR neutral, "tú"); code, identifiers, tables, commits in English. next-intl, `es` source + `en`
  (`messages/*.json`, locale from the `visitas_locale` cookie, no URL prefix); never hardcode UI text; ICU plurals;
  `fmtDate`/`fmtNumber` (`src/lib/format.ts`) with the UI locale and `Site.timezone`.
- Multi-site by `Site`: every query filters by `siteId` from `requireMembership(role)` (`admin|security|approver|host`;
  `admin` with `siteId = null` sees all sites). Use `tenant.siteFilter` in Prisma `where`; ids from the browser
  (pass, visit, employee, gate, device) are re-checked with `assertSiteAllowed`. Never trust form ids.
- Auth (`src/lib/auth/*`): DB sessions (`Session.tokenHash`, cookie `visitas_session`), Microsoft Entra ID via
  OIDC + PKCE with `openid-client` (`entra.ts`; sign-in button appears only when `ENTRA_*` are set), JIT user
  provisioning linked by email to `Employee` (`users.ts`). Local break-glass admin: password (scrypt) + TOTP
  (`totp.ts`, RFC 6238). Kiosk `/guard`: enrolled `GuardDevice` (HttpOnly `visitas_device`, enrollment code from
  `/admin/devices`) + security staff PIN (`User.pinHash`), 12 h session, `Lock` ends it.
  Auth.js was not used: its Credentials provider cannot use DB sessions, and we need one session model for
  Entra, local admin and kiosk.
- `Employee` is a read-only mirror of SPN (`spn.dbo.empleados`) + Entra; synced hourly (`src/lib/sync/employees.ts`,
  Phase 1) or pushed by `tools/sync-agent` to `/api/sync/employees` (HMAC `SYNC_SECRET`). Never write to SPN.
- Dates stored UTC; displayed in `Site.timezone` (default America/Santo_Domingo). `src/lib/time/tz.ts` for wall-clock math.
- Passes: QR payload `passId.exp.sig` (HMAC `PASS_SIGNING_KEY`, 16-byte base64url) or `passId.r<step>.sig` for the
  rotating TOTP QR of recurring passes; validation only in `src/lib/passes/validate.ts` (pure, unit-tested) +
  atomic `uses` increment in `src/lib/server/passes.ts` (`consumePassUse`). Policies (`VisitPolicy`) are data,
  evaluated by `src/lib/policies/evaluate.ts`; `DEFAULT_POLICIES` only seeds them.
- Identity documents: never store the full number — `docHash` (HMAC `DOC_HASH_KEY`) + `docLast4`
  (`src/lib/crypto/docHash.ts`); photos private in the bucket (`s/<siteId>/visits/…`), served by `/api/media`
  with an access check, purged after `settings.retentionDays`.
- Guard app works offline: scans queued in IndexedDB, blacklist + evacuation list cached, server dedupes by `Visit.scanId`.
- Badges: 4" × 2" direct-thermal label on Zebra ZP450 (203 dpi, 812 × 406 dots, ZPL II), printed at entry and used as
  the active badge: visit QR, visitor/company/host/area, warnings, optional dithered B&W photo from the kiosk camera.
  Spec in `docs/BADGES.md`. ZPL in `src/lib/badges/zpl.ts` (pure, snapshot-tested); printing through
  `tools/print-agent` (USB raw or port 9100, HMAC `PRINT_AGENT_SECRET`) or Zebra Browser Print. Badge number =
  `Visit.badgeNo` (`<gate>-<daily seq>`).
- Notifications: payload = ids + ICU args, rendered in the reader's language. Channels: Teams (Power Automate webhook,
  Adaptive Cards; actions call `/api/teams/action` signed with `TEAMS_ACTION_SECRET`), Web Push, email.
  `visit_at_gate`, `blacklist_hit`, `carrier_at_dock` ignore quiet hours. `NOTIFY_FAKE=1` in tests.
- Uploads through `putFile` (sniffed, re-encoded, metadata stripped). CSP with nonce (`src/lib/csp.ts`, set in
  `middleware.ts`); no new origins without `buildCsp`. Forms are plain `<form action={serverAction}>` with
  `?error=`/`?ok=` redirects, so pages stay server components and CSP-safe.
- Rate limits in Postgres (`src/lib/rateLimit.ts`); background jobs/cron under `withAdvisoryLock`; no in-memory state
  across requests (several replicas). Structured JSON logs via `src/lib/log.ts`; Sentry only when `SENTRY_DSN` is set.
- Audit important events with `audit()` (`src/lib/audit.ts`, typed `AuditAction`): pass created/approved/revoked,
  visit approved/denied/entered/left, blacklist hit, NDA accepted, policy/settings changed, device enrolled, member
  added, employee sync, logins.
- Icons: Lucide via `<Icon>`; no emojis in UI. Light/dark via CSS variables in `src/app/globals.css`; Airlink brand
  tokens in `src/styles/brand.css` (black wordmark + red chevron; white/red in light, black/red in dark).
  Wordmark `<Logo>` and square `<LogoMark>` in `src/components/Logo.tsx`; PWA icons in `public/icons`
  (regenerate with `node scripts/make-icons.mjs public/icons/icon.svg public/icons`).
- Secrets: signing keys, shared secrets and the VAPID pair come from `getSecret(name)` (`src/lib/secrets.ts`): a Railway
  variable wins, otherwise a value generated on first boot and stored in `SystemSecret` (seed pre-generates them).
  Never read them with `env()` directly, never print them in chat, logs or files. `.env.example` lists names only.

## Commands
- `npm run dev` · `build` · `lint` · `typecheck` · `test` · `test:e2e` · `db:migrate` · `db:deploy` · `db:seed`
- `npm run cron:tick` · `npm run ops:backup` · `npm run sync:employees`
- E2E in the Claude container: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`
  (needs a running `npm run start` or let Playwright start it; Postgres on `DATABASE_URL`, seeded).

## Infra
- GitHub `virgax/Airlink_Visitor-Management-System`: `main` (production) and `develop` (staging), both protected,
  PR + CI required.
- Railway project `airlink-visitas` (id 1942b6a4-0cd3-4fe8-b5ad-7b15c881b7bb), described in `.railway/railway.ts`
  (IaC; `railway config plan/apply`). Services: `web` (deploys `main`, `npm run build` / `npm run start:prod`,
  healthcheck `/api/health/ready`), `Postgres`, bucket `visitas-media` (iad), `ops-cron` (*/5 min, `npm run cron:tick`),
  `ops-backup` (07:00 UTC, ops/backup.Dockerfile with pg_dump 17, `npm run ops:backup`). Cron schedules and the
  Dockerfile path live on the services (not in the SDK yet). railway.json is deprecated by Railway; do not add one.
  Environments `production` (main) / `staging` (develop).
- Domain `visitas.airlinkdr.com` at Cloudflare (proxied, SSL Full).
- Integrations: Entra ID app registration "Airlink Visitas"; Power Automate HTTP flow for Teams; SPN read-only;
  Zebra printers; AirlinkCast lobby screen (phase 2).

## Working method
- Phases are split into slices; each slice runs in its own git worktree with its own DB (`visitas_<slice>`), port and QA,
  plus one reviewer per slice. The integrator merges into `develop`, runs the full suite, regenerates help screenshots,
  then PRs `develop` → `main`.
- Stop and ask Jaime before: creating billable resources, DNS changes, deleting data, anything touching SPN beyond reads.

## Phase status
- Phase 0 ✅ repo, CI, schema + migration, auth (local + TOTP, Entra OIDC, kiosk device + PIN), multi-site
  memberships, panel selector, i18n es/en, light/dark + brand, PWA, health, cron tick, backup script, seed.
  Railway project, Postgres, bucket, crons and non-secret variables ✅.
  Secrets self-generated on first boot ✅. ⏳ Jaime: custom domain DNS, Sentry DSN, Entra app registration.
- Phase 1 ✅ merged into `develop` (slices A–E, see `docs/PHASE1_SLICES.md`): admin CRUD (sites, gates, areas,
  policies, companies, blacklist, employees) + SPN sync endpoint/agent; host passes + approvals + `/v/<token>` with
  static/rotating QR, pre-registration and NDA; kiosk scanner, unannounced visits, inside/evacuation lists, offline
  queue; notification channels (push, Teams, email) + in-app list + quiet hours + cron escalation; shift log and
  reports with CSV. ⏳ production pilot feedback, Entra sign-in test with real tenant, SPN agent on the file server.
- Phase 2 · badges (Zebra ZP450, `docs/BADGES.md`), VPASS-inspired additions (`docs/REFERENCE_VPASS.md`: auto sign-out,
  auto-print, extra fields per kind, gate QR self sign-in, manual sign-in from admin, quick date filters, search),
  recurring/carrier/delivery polish, shifts, PDF, AirlinkCast.
- Phase 3 · AI doc/plate reading, access hardware, self-service kiosk.
