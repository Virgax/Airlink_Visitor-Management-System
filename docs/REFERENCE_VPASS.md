# Reference: VPASS screens (shared by Jaime, 2026-10-28)

What the reference product does well and how it maps to Airlink Visitas. Items marked **P2** go into Phase 2 slices;
**done** already exists; **later** is Phase 3+.

## Reports (home)
| VPASS | Ours | Status |
|---|---|---|
| Site + Location filters at the top | Site switcher (panel selector) + gate filter in `/admin/reports` | done |
| KPI tiles: Active Visitors / Total Sign Outs / Total Sign Ins | Dashboard counts on `/admin` (inside now, entered today, pending, incidents) | done; **P2**: add "salieron hoy" tile and show the three tiles on `/admin/reports` too |
| Date range with a **Today** button, "Recent Activity", Reset | Date range exists; **P2**: `Hoy` / `Ayer` / `Esta semana` quick buttons, "Actividad reciente" (last 2 h, any date) | P2 |
| Search box (name, company) | Filters by host/company only; **P2**: free-text search over visitor name, company, host, plate, docLast4 | P2 |
| Export | CSV export | done |
| **Emergency Report List** button (always visible, red) | Evacuation list exists at `/guard/evacuation`; **P2**: same list reachable from `/admin` (red button) and printable for all sites | P2 |
| **Sign-in** button (manual sign-in from the admin UI) | Only the kiosk registers visits; **P2**: `/admin/reports` → "Registrar visita" (reception PC without kiosk enrollment, audited `via: admin`) | P2 |
| Custom Field 01/02 columns, Tags | **P2**: per-visit tags (Company blocked, Escort, NDA) as columns; custom fields come with forms (below) | P2 |
| Rows per page | Pagination 50/page; **P2**: 25/50/100 selector | P2 |

## Badge printing templates
| VPASS | Ours | Status |
|---|---|---|
| 4 templates: portrait / landscape, with / without photo; logo, visitor type, name, custom field, check-in time, QR | `docs/BADGES.md` defines one 4"×2" landscape layout with photo. **P2**: implement 2 variants (landscape with photo = default, landscape without photo) selectable per site in `Site.settings.badgeTemplate`; portrait only if a different label stock appears | P2 |
| "To enable printing go to Visitor Types" | `VisitPolicy.badge` per kind | done |
| Auto-print badge per visitor type | **P2**: `VisitPolicy.autoPrintBadge` → kiosk prints right after the green screen without the extra tap | P2 |

## Sites & Locations
| VPASS | Ours | Status |
|---|---|---|
| Site → Locations (e.g. Recepción) each with its own **QR** for self sign-in and a printer icon | Site → Gates. **P2**: gate QR poster (`/admin/sites/[id]` → "Imprimir QR de la puerta") that opens a public self-registration page `/s/<gateToken>` creating an unannounced visit (same flow as the kiosk form, host search limited to names) | P2 |
| Download location QR / assign printer | **P2**: per-gate printer assignment (`Gate.settings.printer`) used by the print agent | P2 |

## Visitor Types (= our VisitKind + VisitPolicy)
| VPASS | Ours | Status |
|---|---|---|
| Sign In Form / Sign Out Form per type (custom forms) | **P2 (light)**: `VisitPolicy.extraFields` JSON (label, type text/select/checkbox, required) rendered on the host form, the visitor pre-registration and the kiosk unannounced form; answers in `Pass.extra` / `Visit.extra` JSON (schema change: add two `Json?` columns). Full form builder is **later** | P2 |
| Badge Printing Yes/No | `VisitPolicy.badge` | done |
| **Auto Sign Out** at a time of day (11:59 PM) | **P2**: `VisitPolicy.autoSignOutAt` ("HH:mm", site time zone). Cron tick closes `inside`/`at_dock` visits past that time with `leftAt` = that instant, `Visit.autoClosed = true`, audit `visit.left` (meta auto) | P2 |
| Registered visitor type (employees, temps, registered contractors: no form, scan only) | Recurring passes with rotating QR cover contractors; employees are not visitors (SPN). **later**: employee time clock if Victor asks (plan §5 Phase 4) | later |
| Status toggle per type | **P2**: `VisitPolicy.enabled` (disabled kinds hidden from host form) | P2 |
| Sign Out Only type | not needed (check-out is by QR/badge) | skip |
| Email notification list per type | **P2**: `VisitPolicy.notifyEmails` (comma list) → `notify` adds an email channel target for `visit_entered` of that kind | P2 |

## Employees (sub-views All / Access / Hosts / Admins / Fire Wardens)
| VPASS | Ours | Status |
|---|---|---|
| One list of employees with role columns Host? / Admin? / Fire Warden? / Active and a per-row toggle | `/admin/employees` (directory) and `/admin/members` (roles) are separate. **P2**: merge into one "Personas" screen: directory row + role chips (Anfitrión = active employee, Admin / Seguridad / Aprobador = memberships, Brigadista = new) with inline toggles; sub-view tabs Todos / Con PIN / Anfitriones / Admins / Brigadistas | P2 |
| **Pin Code** per employee ("Access") | Security staff have a kiosk PIN. **P2**: optional PIN for any employee, used for (a) kiosk sign-in by security and (b) employee self check-in on the gate QR page when they forgot their badge (audited, employees are not visitors so it only logs presence for the evacuation list) | P2 |
| **Fire Warden** role | New membership role `warden` (brigadista): receives `evacuation_list` push on demand and when an incident of kind `evacuation` is logged, can open the evacuation list from `/app/evacuacion` on the phone (read-only, offline-cached), and can mark people as "contado" during a drill. Schema: add `warden` to `MembershipRole` | P2 |
| Search, status filter (Active/Inactive), bulk select + delete, rows per page | **P2** on the merged screen; bulk *deactivate* instead of delete (SPN mirror must not be deleted) | P2 |
| Add Employee (manual) | exists (manual source) | done |

## Decisions
- Keep policies as data (`VisitPolicy`) instead of VPASS-style "forms"; add the few fields above rather than a form builder.
- Keep our kiosk + host-invitation flow as the primary path; the gate QR self sign-in is an addition for walk-ins, not a replacement.
- Schema changes needed in Phase 2 (one migration): `VisitPolicy.autoPrintBadge`, `autoSignOutAt`, `enabled`, `notifyEmails`, `extraFields`; `Pass.extra`, `Visit.extra`, `Visit.autoClosed`; `Gate.selfSignInToken`, `Gate.settings`; `MembershipRole.warden`; `Employee.pinHash` (or keep PIN on `User` and create the user on first PIN); `EmployeePresence` (self check-in log for the evacuation list).
