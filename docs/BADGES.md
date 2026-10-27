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
- `src/lib/badges/zpl.ts`: pure `renderBadgeZpl(badge: BadgeData): string` (snapshot-tested, no DB), plus
  `bitmapToGfa(bits, width, height)`.
- `src/lib/badges/dither.ts`: client-side grayscale + Floyd–Steinberg to a 1-bit array (unit-tested on small inputs).
- `src/app/api/guard/badges/[visitId]/zpl/route.ts`: kiosk session, re-checks site, returns `text/plain` ZPL.
- `tools/print-agent/`: Node script on the reception PC: polls `/api/print/jobs` (HMAC) or receives a local POST from
  the kiosk page, writes raw ZPL to the printer (USB raw / `\\.\USB001` on Windows or TCP 9100).
- Kiosk: after a green scan or an in-person approval, "Imprimir gafete" button with a preview rendered from the same
  `BadgeData` (HTML, same layout) and the optional photo capture step.
- Reprint from `/guard/inside` (audited `badge.reprinted`).

## Confirmed by Jaime (2026-10-27)
- Reception PCs are **Windows**, each ZP450 connected by **USB directly**. `tools/print-agent` therefore runs as a
  Windows service/startup script and writes raw ZPL to the Zebra driver's shared printer with `RAW` datatype
  (Win32 spooler, e.g. through PowerShell `Out-Printer` is NOT raw; use the `winspool` API via a small helper or
  `copy /b file.zpl \\localhost\ZP450`, with the printer shared under a fixed name). Pass-through mode
  must be enabled in the ZDesigner driver ("Use printer settings" off, raw passthrough on).
- Labels are **pre-cut with gaps** → `^MNY` (web/gap sensing). Run auto-calibration once per roll change.

## Open points for Jaime
- Photo consent text to add to the visitor policy (NDA v1.1).
