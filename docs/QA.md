# QA rounds

## 2026-11-25 · Round 1 (local build, three scenario testers following the guides)

Testers: admin + host (Airlink 2), security at the kiosk (Airlink 3), visitor on a phone viewport (Airlink 2).
Method: Playwright driven by labels, as a user would, following `/help` and the PDF; DB read only to verify what was
stored. Photos were out of scope (no media bucket locally).

### Verified working
Admin sign-in and panel selector; site settings, areas, Wi-Fi; people (create host + password, security + PIN, edit,
permissions, delete); form editor (list question, devices block, assignment to a policy); kiosk devices + enrollment
code + checkpoint gate; kiosk activation (/guard, code, PIN), change of device; scanning valid/expired/revoked/
not-yet-valid passes with the right reasons; walk-ins with devices, in-person and remote approval, deny; IMEI/serial
lookup and `devices_required`; checkpoint verify-only; inside list, evacuation list, print, manual sign-out, shift log,
lock; host passes (visit, contractor with approval, on behalf of another host), invitation links for a group, renew
validity, consult/correct devices; reports and CSV; visitor registration with devices, "no devices", MRZ reader,
visitor policy acceptance, locked link, English, revoked/404 pages; arrival at the kiosk shows devices, host, areas,
document, plate, tools.

### Bugs found and fixed in this round
1. Invitation link could not be created when the visit type's form had required host-surface elements (the host form
   now hides them; the visitor answers from the link; the server ignores host answers for self-registration).
2. Site rule checkboxes rendered 3 px wide.
3. Kiosk device form: gate list ignored the site (the site field is gone; gates are grouped by site).
4. "Enviar invitación" button overflowed its card.
5. Checkpoint gates showed printer and self sign-in controls.
6. No way to reach the kiosk from /login (link added).
7. Checkpoint devices could mark exits and register walk-ins by URL (refused now, page and API).
8. Walk-in for a host without an account said "host notified" (the kiosk now says to call them and approve in person).
9. Expired pass reported as "QR expired" (now "pass expired").
10. All-sites admin could not open Approvals (admins approve as security now).
11. Checkpoint offered as an entry gate in the pass form / policies.
12. Revoked message blamed the host; manual non-QR input explained only as IMEI.
13. Visitor link: typed data lost after a server validation error (IMEI/serial now validated by the browser before
    submit); misleading IMEI message; duplicate `id="name"` on the policy signature; "Usado" while the visitor is
    inside (now "Dentro de la planta"); kiosk showed "NDA" as a warning even when accepted (green chip now).

### Guide/UX changes
Admin menu rebuilt as sections with dropdowns; every guide path rewritten as "Sección → Página" with a new step and
screenshot; approvals location; no "host" role; password under Editar → Acceso; "Eliminar definitivamente";
"Editar formulario" after assigning; language selector + OK; Wi-Fi share box; where the enrollment code shows and
that "Cambiar de dispositivo" needs a new code; kiosk results and what to do; "Aprobado en persona" vs "Registrar
entrada"; checkpoint needs PIN and has "Verificar acceso"; badge panel ("Listo", ZPL file); how to resolve
`devices_required`; host approval lives in the notifications bell; visitor chapter rewritten (order, second "Aceptar"
form, pending approval, device formats, what the pass shows, arrival rules, expired/cancelled, locked link, language).
Visitor link: scanner before the name, devices after personal data, "A tu llegada" rules block, areas + escort on the
pass, pending/expired/cancelled/inside notes, privacy note on the scanner.

### Not covered (needs production or hardware)
Photos (face/ID) and the badge photo, real camera scanning, Zebra printing, offline mode, push/Teams/email delivery,
Entra sign-in, PIN entry at the kiosk, blacklist hits, code expiry and PIN lockout, auto sign-out/auto-print.
