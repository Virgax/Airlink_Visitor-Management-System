# Phase 2 — slices

Schema is frozen in `develop` (migration `20261028131500_phase2_forms_people_ops`): do not edit `prisma/schema.prisma`;
report needed changes instead. Shared deps are installed (`sharp`, `qrcode`, `@zxing/browser`, `idb`, `web-push`, `nodemailer`);
do not add others. Specs: `docs/BADGES.md`, `docs/REFERENCE_VPASS.md`.

| Slice | Branch | DB | Port | Scope |
|---|---|---|---|---|
| F | feat/badges-zebra | visitas_f | 3106 | Badge printing: `src/lib/badges/zpl.ts` (pure, snapshot-tested), `src/lib/badges/dither.ts`, badge photo capture at the kiosk (`Visit.badgePhotoKey`), `Visit.badgeNo` sequence per gate/day, `/api/guard/badges/[visitId]/zpl`, kiosk "Imprimir gafete" + reprint, `tools/print-agent` (Windows, USB raw), `Site.settings.badgeTemplate` (landscape with/without photo), `VisitPolicy.autoPrintBadge` |
| G | feat/forms | visitas_g | 3107 | Form templates for HR: `/admin/forms` list + visual editor (ordered elements, properties panel, preview), `VisitPolicy.formTemplateId` / inline `form`, renderer used by host invite form, `/v/<token>` pre-registration, kiosk unannounced form; answers in `Pass.extra` / `Visit.extra`; `evaluatePolicy` reads the form (photo/document/phone/email/company/plate/areas/escort modes); drawn signature for the NDA (`signature` element) stored in the bucket; `NdaVersion.attachmentKey`; CSV columns for custom answers |
| H | feat/visit-ops | visitas_h | 3108 | `VisitPolicy.enabled`, `autoSignOutAt` (cron job), `notifyEmails`; gate QR poster + public self sign-in `/s/<gateToken>` (unannounced visit + employee PIN presence); manual "Registrar visita" from `/admin/reports`; quick date filters (Hoy/Ayer/Semana), free-text search, rows per page, red "Lista de evacuación" button on `/admin` (all sites, includes `EmployeePresence`) |
| I | feat/people | visitas_i | 3109 | Merged "Personas" screen (`/admin/people`: directory + role chips + tabs, bulk deactivate, employee PIN), `warden` role (`/app/evacuacion` read-only list, roll call during drills, `evacuation_list` push on demand), frequent visitors (`/admin/frequent`: QR card / PIN → recurring pass, host autocomplete), `Pass.pinHash` (6-digit PIN typed at the kiosk, `/api/guard/pin`), invite by e-mail from the pass detail, `/admin/reports/invites` |

Shared contracts:
- Kiosk pages use `requireKiosk()` / `kioskRoute()` from `src/lib/auth/kiosk.ts`; web pages `requireMembership`.
- `notify()` in `src/lib/notifications/index.ts` is the only notification entry point.
- `evaluatePolicy` (`src/lib/policies/evaluate.ts`) stays pure; slice G extends its input with the form.
- UI text in `messages/*.json` under namespaces `badges.*`, `forms.*`, `ops.*`, `people.*`.
