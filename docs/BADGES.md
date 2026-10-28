# Badges (gafetes) — Phase 2 spec

Decision (Jaime, 2026-10-27): print a 4" × 2" thermal label on the Zebra **ZP450** at reception when the visitor
enters. The label *is* the active badge: it carries the visit QR (or the cédula-derived code), the visitor's data
and, when the kiosk has a camera, a quick black-and-white photo taken on site.

## Printer facts
- Zebra ZP450: direct thermal, **203 dpi**, 4" print width. Speaks **ZPL II** and EPL2; we use ZPL.
- Label 4" × 2" → **812 × 406 dots** (`^PW812`, `^LL406`). Leave a 16-dot safe margin on every side.
- Connection: USB on the reception PC (Zebra Browser Print or `tools/print-agent` talking to the local driver),
  or network via a print server on port 9100 when available. `tools/print-agent` is the default (same HMAC pattern
  as the sync agent, `PRINT_AGENT_SECRET`); Browser Print is the fallback for kiosks without the agent.
- Direct thermal labels fade with heat/sun: fine for a one-day visitor badge; not for recurring passes (those keep
  the rotating QR on the phone).

## Label layout (812 × 406)
```
┌──────────────────────────────────────────────────────────────────┐
│ [photo 160×200, dithered]  VISITANTE / CONTRATISTA / AUDITOR …   │
│                            Juan Pérez                 (^CF0,48)  │
│                            Uptime SRL                            │
│                            Anfitrión: María Gómez · IQC          │
│                            Entrada: 27 oct 2026 09:14 · Rec. A2  │
│ ACOMPAÑADO · SIN FOTOS     [QR 180×180]   Gafete #A2-0042        │
└──────────────────────────────────────────────────────────────────┘
```
- Photo: optional, grabbed from the kiosk camera (`getUserMedia`) right after the green screen, resized to
  160×200, converted to 1-bit with Floyd–Steinberg dithering client-side, sent as the `^GFA` hex bitmap. Stored
  in the private bucket under `s/<siteId>/visits/<visitId>/badge.png` only if the site enables photos
  (`settings.requireDocPhoto` / retention applies). Never stored in Postgres.
- QR (`^BQN,2,6`): the **visit** payload `visitId.sig` (HMAC, same key family as passes) so the badge can be scanned
  for check-out and for area checks; it is not the pass QR (single-use passes are already consumed by then).
  When the visitor has a cédula on file, `docLast4` is printed as text; the full number never appears.
- Warnings line comes from the policy evaluation (`escort`, `no_photos`, `reception_only`).
- Badge number `Visit.badgeNo` = `<gate code>-<daily sequence>` (e.g. `A2-0042`), reset per site per day.

## Code map (slice `feat/badges-zebra`)
- `src/lib/badges/zpl.ts`: pure `renderBadgeZpl(data, template)` for `landscape_photo` | `landscape` (snapshot-tested,
  no DB), `bitmapToGfa(bits, width, height)`, `zplText` (control chars stripped, lengths capped). Labels arrive
  translated in `BadgeData.labels` (namespace `badges.label`).
- `src/lib/badges/dither.ts`: grayscale + Floyd–Steinberg → packed 1-bit (MSB first, 1 = black); runs in the kiosk
  browser and in `tests/dither.test.ts`. `src/lib/badges/photo.ts` decodes the stored PNG back to bits (sharp).
- `src/lib/badges/visitQr.ts`: `signVisitQr` / `verifyVisitQr` (`visitId.sig`, HMAC with `PASS_SIGNING_KEY`). The scan
  route recognises the two-part payload and checks the visitor out (`visit_closed` when already out).
- `src/lib/badges/badgeNo.ts` + `src/lib/server/badges.ts`: `assignBadgeNo(visitId)` → `<site code><gate initial>-NNNN`
  (`airlink-2` + `Recepción` → `A2R-0042`), per site per local day, atomic (advisory lock + conditional update).
  `loadBadge` / `renderVisitBadge` / `auditBadgePrint` (`badge.printed`, `badge.reprinted`).
- `src/lib/badges/config.ts`: `Site.settings.badgeTemplate`, `Gate.settings.printer = { kind: "agent"|"browser", name }`.
- API (kiosk session, same site): `GET /api/guard/badges/[visitId]` (preview JSON + QR SVG),
  `GET /api/guard/badges/[visitId]/zpl` (text/plain; audited unless `?audit=0`; `?reprint=1`),
  `POST /api/guard/badges/[visitId]/photo` (1-bit PNG → `s/<siteId>/visits/<visitId>/badge.png`, `Visit.badgePhotoKey`).
- Print queue without a table: `POST /api/print/enqueue` writes the ZPL to the bucket under
  `s/<siteId>/print/<gateId>/<ms>-<visitId>.zpl`; `tools/print-agent` polls `GET /api/print/jobs?gate=` and acks with
  `DELETE …&job=` (HMAC `PRINT_AGENT_SECRET`, `x-timestamp` + `x-signature` over `METHOD\n/path?query\nts`).
  `src/lib/print/queue.ts`.
- Kiosk: `src/components/guard/BadgePanel.tsx` (photo step → preview `BadgePreview.tsx` → print) shown by `Scanner`
  after a green scan and by `PendingVisits` after an in-person approval; `VisitPolicy.autoPrintBadge` prints without
  the tap. Reprint: `/guard/inside` → `/guard/badge/[visitId]`. Without a printer on the gate the `.zpl` is downloaded.
- Zebra Browser Print (`kind: "browser"`): the kiosk POSTs the ZPL to `http://localhost:9100/write`; the PIN sign-in
  sets the `visitas_print` cookie so the middleware adds that origin to `connect-src` (`buildCsp({ browserPrint })`)
  only for that kiosk. Changing the gate's printer takes effect at the next PIN sign-in.
- Admin: `/admin/sites/[id]` (template per site, printer per gate), `/admin/policies` (auto-print per kind).

## Confirmed by Jaime (2026-10-27)
- Reception PCs are **Windows**, each ZP450 connected by **USB directly**. `tools/print-agent` therefore runs as a
  Windows service/startup script and writes raw ZPL to the Zebra driver's shared printer with `RAW` datatype
  (Win32 spooler, e.g. through PowerShell `Out-Printer` is NOT raw; use the `winspool` API via a small helper or
  `copy /b file.zpl \\localhost\ZP450`, with the printer shared under a fixed name). Pass-through mode
  must be enabled in the ZDesigner driver ("Use printer settings" off, raw passthrough on).
- Labels are **pre-cut with gaps** → `^MNY` (web/gap sensing). Run auto-calibration once per roll change.

## Open points for Jaime
- Photo consent text to add to the visitor policy (NDA v1.1).

## Pendiente (follow-up)

- **Secreto de impresión por puerta.** Hoy todos los agentes de impresión comparten `PRINT_AGENT_SECRET`; un agente
  comprometido en una puerta podría aceptar trabajos de cualquier otra. Pendiente: `Gate.printSecretHash` emitido desde
  `/admin/gates` (rotable), y que el agente se identifique con `gateId` + HMAC con su propio secreto.
