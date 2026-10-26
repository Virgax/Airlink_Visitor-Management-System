# Airlink Visitas — Control de Visitantes para Airlink Distribution DR

> **Para Claude Code.** Este documento es el brief completo del proyecto: producto, arquitectura, modelo de datos, fases, infraestructura (GitHub + Railway) y el `CLAUDE.md` inicial del repo. Léelo entero antes de ejecutar nada. La sección 13 es el plan de ejecución paso a paso; la sección 14 es el `CLAUDE.md` que debes crear en la raíz del repo.
>
> Mismo stack y forma de trabajar que **Fitness Together**: Next.js + Prisma + Postgres en Railway, GitHub con CI que bloquea el deploy, PWA primero, Capacitor después, equipos de agentes en paralelo por fase (git worktrees).
>
> **Nombre de trabajo:** Airlink Visitas. En el código: `visitas`. Repo: `virgax/airlink-visitas`. Proyecto Railway: `airlink-visitas`.

---

## 1. Qué resolvemos

Airlink Distribution DR (planta de refurbishment de dispositivos en Santo Domingo, programas con Assurant/AT&T, Samsung, etc.) recibe a diario proveedores, contratistas, técnicos, transportistas, auditores de clientes, candidatos a entrevista y mensajería. Hoy eso se controla con libreta en seguridad, llamadas al anfitrión y WhatsApp. Eso deja:

- visitantes que seguridad no puede confirmar rápido con el anfitrión,
- ningún registro confiable de **quién entró, cuándo, a ver a quién y a qué área**,
- contratistas y transportistas entrando sin control ni documento,
- cero evidencia para auditorías (ISO 9001, requisitos de seguridad de clientes como Assurant/AT&T),
- nadie sabe **quién está dentro de la planta ahora mismo** (lista de evacuación),
- no hay manera de vetar a alguien ni de exigir acuerdos (NDA, política de fotos/teléfonos).

**La promesa:** el empleado invita desde el celular o Teams → el visitante llega con un QR (o su nombre/cédula) → seguridad lo valida en segundos, imprime el gafete y registra entrada → el anfitrión recibe aviso → todo queda en bitácora exportable para auditoría.

Diferencias clave respecto al plan original tipo VPASS (residencial):

| Residencial (original) | Airlink |
|---|---|
| Multi-tenant por comunidad, planes, facturación | Una empresa, **multi-sitio** (Airlink 2, Airlink 3, New Airlink 2) |
| Residente | **Anfitrión** = empleado (sincronizado desde SPN) |
| Unidad (apto/casa) | **Área / departamento** y **sitio** |
| Auth propia (contraseña, passkeys) | **Microsoft Entra ID (M365 airlinkdr.com)** para empleados; PIN para kiosco de seguridad |
| Push + WhatsApp | **Teams** (Power Automate / webhook) + Web Push + correo |
| Talanquera residencial | Gafete impreso en **Zebra**, lista de evacuación, bienvenida en **AirlinkCast** |

---

## 2. Roles

| Rol | Dónde vive | Quién | Qué hace |
|---|---|---|---|
| **Admin** | `/admin` | IT (Jaime), Seguridad, RRHH | Sitios, puertas, áreas, políticas, lista negra, plantillas, reportes, configuración de integraciones |
| **Anfitrión** | `/app` | Cualquier empleado con cuenta M365 | Invita (individual, grupo, recurrente), aprueba/rechaza no anunciados, ve su historial, autoriza deliveries |
| **Aprobador** | `/app` (vista extra) | Jefes de área, Seguridad, RRHH | Aprueba visitas que por política requieren segunda aprobación (contratistas, auditores, zonas restringidas) |
| **Seguridad / Recepción** | `/guard` (modo kiosco) | Guardias y recepcionista | Escanea QR, registra no anunciados, entrada/salida, imprime gafete, incidentes, rondas, lista de evacuación |
| **Visitante** | Link público `/v/<token>` | Externo, sin cuenta | Ve su pase (QR, dirección, instrucciones, política), acepta NDA/política si aplica, pre-llena sus datos |

Una cuenta puede tener varios roles (un admin también es anfitrión). Selector de panel igual que FT.

---

## 3. Tipos de visita

Cada tipo tiene plantilla, campos requeridos y política (aprobación, documento, gafete, acompañamiento, NDA):

| Tipo | Ejemplos | Política por defecto |
|---|---|---|
| `visit` | Visita general, reunión | Aprobación del anfitrión; cédula; gafete |
| `candidate` | Entrevista RRHH | Anfitrión = RRHH; gafete; sin acceso a producción |
| `contractor` | Técnico, mantenimiento, construcción (New Airlink 2) | Cédula; **aprobación de Seguridad**; acompañamiento; NDA; recurrente permitido |
| `vendor` | Proveedor, vendedor | Cédula; gafete |
| `auditor` | Assurant, AT&T, Samsung, certificadora ISO | **Aprobación de gerencia**; NDA; acompañamiento; registro de áreas visitadas |
| `carrier` | Transportista / camión en muelle | Placa, empresa, número de guía o PO; entrada por puerta de carga; sin gafete, sí registro |
| `delivery` | Mensajería, comida | Sin cédula; aviso al anfitrión; no pasa de recepción |
| `recurring` | Contratista de limpieza, seguridad externa, chofer fijo | Pase con días/horario; aprobación de Seguridad; QR rotativo |

Políticas configurables por sitio desde `/admin` (tabla `VisitPolicy`), no hardcodeadas.

---

## 4. Flujos principales (MVP)

**Invitación anticipada**
1. El anfitrión crea un pase: nombre, empresa, teléfono/correo opcional, tipo, una vez o recurrente, ventana horaria, sitio, puerta sugerida, área a visitar, acompañado sí/no.
2. Si la política exige segunda aprobación, el pase queda `pending_approval` y se notifica al aprobador.
3. Se comparte por WhatsApp/correo (share sheet) el link `/v/<token>` con el QR, dirección, instrucciones de llegada y la política de visitantes. El visitante puede pre-llenar sus datos y aceptar el NDA desde el link.

**Llegada con QR**
1. Seguridad escanea. El servidor valida firma, ventana, usos restantes, puerta, lista negra, NDA aceptado si aplica.
2. Pantalla verde o roja con nombre, empresa, anfitrión, área, foto si existe, y avisos (acompañamiento, zona restringida, sin fotos).
3. Un toque registra la entrada, imprime el gafete (Zebra, ZPL) y notifica al anfitrión («Juan Pérez de Uptime ya está en recepción»).

**Visita no anunciada**
1. Seguridad busca al anfitrión (directorio desde SPN, con foto) y escribe nombre/empresa del visitante; opcional foto de cédula.
2. Teams + push al anfitrión: «Juan Pérez (Uptime) está en recepción» → Aprobar / Rechazar / «Voy en camino».
3. Sin respuesta en X minutos → escalar al suplente del área o mostrar extensión/teléfono.

**Salida:** escanear de nuevo, marcar «Salió» o escanear el gafete. Las visitas abiertas se ven en el panel de seguridad y en la **lista de evacuación** (`/guard/evacuation`, imprimible, funciona offline).

**Transportistas / muelle:** plantilla rápida con placa, empresa, chofer, guía/PO, puerta de carga; estados `waiting_dock` → `at_dock` → `left`.

**Deliveries:** plantilla con empresa; el paquete/comida no pasa de recepción; aviso al anfitrión; opción «recibido por recepción».

**Lista negra y alertas:** Admin/Seguridad vetan por cédula (hash) o placa; el escaneo bloquea y avisa a Seguridad y Admin.

**Bitácora y reportes:** filtros por fecha, sitio, puerta, tipo, anfitrión, área, empresa; exportación CSV/PDF; **reporte de auditoría** (quién estuvo en qué área, NDA aceptado, acompañante) listo para ISO/clientes; bitácora de turno (incidentes, rondas, novedades).

---

## 5. Fases

**Fase 0 — base**
- Repo, Railway (web, Postgres, bucket), CI, dominio.
- Auth: Microsoft Entra ID (OIDC) para empleados; sesiones en BD; PIN para kiosco `/guard`; cuentas locales solo para break-glass admin.
- Multi-sitio (`Site`), PWA, i18n es/en, temas claro/oscuro, marca Airlink.
- Logs, Sentry, backups, healthchecks.

**Fase 1 — MVP de recepción**
- Sitios, puertas, áreas, directorio de anfitriones (sync SPN + Entra).
- Pases con QR firmado, link público, pre-registro del visitante.
- Modo seguridad: escáner con cámara, no anunciados, entrada/salida, offline.
- Notificaciones de aprobación (Teams + Web Push + correo).
- Lista de evacuación, bitácora, reportes básicos, export CSV.

**Fase 2 — operación**
- Políticas por tipo, segunda aprobación, NDA/política de visitantes con aceptación registrada.
- Recurrentes, transportistas/muelle, deliveries, lista negra.
- Gafete impreso en Zebra (ZPL vía agente de impresión local o impresora de red).
- Turnos, incidentes, rondas. Reporte de auditoría. Export PDF.
- Bienvenida en pantalla de lobby vía **AirlinkCast** («Bienvenido, equipo Assurant»).

**Fase 3 — IA y hardware**
- Lectura de cédula dominicana y placa con Claude visión (`runAiCall`, con límites y costos).
- Integración con torniquete/cerradura/talanquera (relé HTTP o MQTT: Shelly/ESP32) para abrir al validar.
- Tablet kiosco de autoservicio en recepción.
- Integración con Spiceworks para incidentes de seguridad y con el dashboard TV.

**Fase 4 — extensión**
- Control de activos que entran/salen con el visitante (laptops, herramientas).
- Pre-registro masivo para eventos/auditorías (CSV).
- Paquetería (paquete recibido → aviso).
- Evaluación: usar el mismo motor para control de acceso de empleados (fichaje) si Victor lo pide.

---

## 6. Arquitectura

```
GitHub virgax/airlink-visitas (main protegida) ──CI verde──► Railway airlink-visitas
                                                           ├─ web       Next.js (App Router), npm run start:prod
                                                           ├─ Postgres  (backups diarios → bucket)
                                                           ├─ bucket    visitas-media (fotos cédula/visitante, privadas)
                                                           ├─ cron      POST /api/cron/tick cada 5 min (expirar pases, escalar, recordatorios, purga)
                                                           └─ backup    cron 07:00 UTC
Cloudflare DNS (p. ej. visitas.airlinkdr.com) → proxied → Railway
Integraciones: Entra ID (OIDC) · SPN (SQL Server, solo lectura) · Teams (Power Automate webhook) · Zebra (ZPL) · AirlinkCast
```

**Stack:** Next.js 15, TypeScript, Prisma 6, Postgres, Tailwind, next-intl (`es` fuente + `en`), Zod, Vitest, Playwright, lucide-react, web-push, `@anthropic-ai/sdk` (Fase 3), `mssql` o `tedious` para SPN (solo lectura).

**Auth:** `next-auth`/Auth.js con proveedor Microsoft Entra ID (tenant airlinkdr.com), sesiones en BD (no JWT en cookie), roles por `Membership`. Kiosco `/guard`: dispositivo registrado + PIN del guardia, sesión larga, bloqueo por inactividad. Cuenta local de emergencia `SEED_ADMIN_EMAIL` con TOTP.

**Directorio de anfitriones:** job cada hora lee `spn.dbo.empleados` (nombre, departamento, extensión, foto) y Entra (correo, estado). Resultado en tabla `Employee` con `source`; nunca se escribe en SPN. Si SPN no está alcanzable desde Railway (red interna), el sync corre desde un agente local (script Node en el file server) que hace POST a `/api/sync/employees` con `SYNC_SECRET`.

**Escáner QR en el navegador:** `BarcodeDetector` donde exista, `@zxing/browser` como respaldo. Seguridad usa la PWA instalada en tablet/celular.

**Tiempo real en recepción:** polling 3–5 s o SSE. Sin websockets en el MVP.

**Offline en recepción:** valida QRs firmados sin red (HMAC + ventana dentro del QR, lista negra en caché, lista de evacuación en caché). Entradas encoladas en IndexedDB; el servidor deduplica por `scanId`.

**Varias réplicas:** nada en memoria; rate limit en Postgres; advisory locks para jobs.

**Impresión Zebra:** servicio `src/lib/badges/zpl.ts` genera el ZPL (nombre, empresa, anfitrión, área, fecha, QR, foto opcional, aviso «ACOMPAÑADO»/«SIN FOTOS»). Envío: (a) impresora de red con puerto 9100 vía agente local `tools/print-agent` (igual patrón que el sync de SPN), o (b) Browser Print de Zebra desde el kiosco. Elegir (a) por defecto.

---

## 7. Modelo de datos (Prisma, resumen)

```prisma
model Site         { id, name /* "Airlink 2" */, slug @unique, address?, timezone @default("America/Santo_Domingo"),
                     settings Json /* retentionDays, requireDocFor[], ndaRequiredFor[], badgeTemplate, lobbyScreenId */, active }
model Gate         { id, siteId, name /* "Recepción", "Muelle", "Portón" */, kind /* pedestrian|vehicle|dock */, active }
model Area         { id, siteId, name /* "IQC", "Almacén", "Oficinas" */, restricted Boolean, escortRequired Boolean }
model Employee     { id, externalId? /* SPN */, entraId?, email?, name, department?, extension?, phone?, photoKey?,
                     siteId?, active, source /* spn|entra|manual */, syncedAt }
model User         { id, email @unique, name, locale?, passwordHash?, totpSecret?, employeeId?, ... }
model Membership   { id, userId, siteId?, role /* admin|security|approver|host */, status }   // siteId null = todos los sitios
model GuardDevice  { id, siteId, gateId, name, deviceToken @unique, pinHash, lastSeenAt, active }
model Company      { id, name, rnc?, kind /* vendor|contractor|client|carrier|courier */, blocked Boolean, notes? }
model VisitPolicy  { id, siteId, kind, requiresApproval Boolean, approverRole?, requiresDoc Boolean, requiresNda Boolean,
                     escortRequired Boolean, badge Boolean, allowedGateIds String[], maxDurationMin? }
model Pass         { id, siteId, hostEmployeeId, createdById, kind, companyId?, visitorName, visitorPhone?, visitorEmail?,
                     visitorDocHash?, visitorDocLast4?, plate?, areaIds String[], escortEmployeeId?,
                     validFrom, validUntil, maxUses @default(1), uses @default(0), schedule Json?, gateIds String[],
                     token @unique, status /* pending_approval|active|used|revoked|expired|denied */,
                     approvedById?, approvedAt?, ndaAcceptedAt?, ndaVersion?, note?, groupId? /* visitas grupales */, createdAt }
model Visit        { id, siteId, gateId, passId?, hostEmployeeId, companyId?, visitorName, docLast4?, docHash?, plate?,
                     photoKey?, kind, status /* pending|approved|denied|inside|at_dock|left|timeout */,
                     requestedById /* guard */, decidedById?, decidedAt?, enteredAt?, leftAt?, badgeNo?,
                     areaIds String[], escortEmployeeId?, scanId? @unique, createdAt }
model Blacklist    { id, docHash?, plate?, name?, companyId?, reason, createdById, until?, siteId? /* null = global */ }
model ShiftLog     { id, siteId, gateId, guardId, kind /* note|incident|round|handover */, text, photoKey?, at }
model NdaVersion   { id, siteId?, version, title, body, activeFrom }
model AuditLog     { ... }   // igual que FT
model Notification, PushSubscription, NativePushToken, NotificationPref   // copiar de FT
```

**Reglas**
- Toda consulta de `/admin`, `/guard` y `/app` filtra por `siteId` según `requireMembership(role)`; `admin` con `siteId null` ve todo. Nunca se confía en ids del navegador.
- Las cédulas **no se guardan completas**: `docHash` (HMAC con `DOC_HASH_KEY`) + `docLast4`. Foto de cédula solo si el sitio lo activa, en bucket privado, retención configurable (90 días por defecto) y purga por cron.
- `Employee` es espejo de solo lectura; `User` existe solo cuando el empleado inicia sesión (JIT provisioning desde Entra, enlazado por correo).
- Fechas en UTC; se muestran en `Site.timezone`.

---

## 8. Seguridad del QR

- Payload `passId.exp.sig`, `sig = HMAC-SHA256(PASS_SIGNING_KEY, passId|exp|siteId)` truncado a 16 bytes base64url.
- **Online:** firma, estado, `uses < maxUses`, ventana, horario recurrente, puerta permitida, lista negra, NDA aceptado si la política lo exige, política de la empresa (`Company.blocked`). Incremento atómico: `UPDATE … WHERE uses < maxUses RETURNING`.
- **Offline:** firma y ventana localmente; reconciliación después; pases usados dos veces se marcan `conflict`.
- Pases de un solo uso mueren al entrar. Recurrentes muestran QR rotativo (TOTP 30 s) en `/v/<token>`.
- Rate limit al escáner y a `/v/<token>`; tokens de 128 bits.
- El link público muestra solo nombre del visitante, empresa, sitio, ventana, instrucciones y política. **Nunca** datos de contacto del anfitrión más allá del nombre.
- Kiosco: `GuardDevice.deviceToken` en cookie HttpOnly + PIN; sin PIN válido no se registra nada aunque el dispositivo esté enrolado.

---

## 9. Privacidad y cumplimiento

- **Ley 172-13 (RD)**: aviso de privacidad visible en recepción (QR al aviso) y en el link del visitante; finalidad limitada al control de acceso y seguridad; retención configurable y purga automática; derecho a solicitar eliminación (`/legal/privacidad`, formulario a IT).
- **ISO 9001 / auditorías de clientes**: el reporte de auditoría es evidencia; la política de visitantes y el NDA se versionan (`NdaVersion`) y se registra qué versión aceptó cada visitante. Documentar el proceso como SOP de Seguridad siguiendo el estándar de documentación Airlink (cajetín, escala de grises, numeración por Document Control).
- Fotos y cédulas privadas, servidas por `/api/media` con verificación de acceso. Nunca base64 en Postgres.
- Datos de empleados: solo lo necesario para el directorio (nombre, departamento, extensión, foto, correo). Nada de salario ni datos sensibles de SPN.

---

## 10. Notificaciones

**Tipos:** `visit_at_gate` (aprobar/rechazar desde la notificación), `visit_entered`, `visit_left`, `pass_pending_approval` (a aprobador), `pass_approved`/`pass_denied` (a anfitrión), `delivery_at_gate`, `carrier_at_dock` (a almacén/logística), `blacklist_hit` (a Seguridad y Admin), `visitor_overstay` (visita abierta pasada `maxDurationMin`), `daily_report` (a Seguridad/Admin, correo), `evacuation_list` (bajo demanda).

**Canales:**
- Fase 1: **Teams** vía webhook de Power Automate (Adaptive Card con botones Aprobar/Rechazar que llaman `/api/teams/action` con firma), Web Push, correo (M365 SMTP/Graph).
- Fase 2: FCM nativo (Capacitor), WhatsApp con plantillas de Meta solo para visitantes (recordatorio del pase), no para empleados.
- Horario de silencio excepto `visit_at_gate`, `blacklist_hit` y `carrier_at_dock`.

---

## 11. Infraestructura (GitHub + Railway)

**GitHub**
- Repo `virgax/airlink-visitas`, rama `main` protegida (PR obligatorio, CI verde, sin push directo).
- `.github/workflows/ci.yml`: `lint` → `typecheck` → `vitest` → `build` → `playwright` contra Postgres de servicio (`postgres:16`). Cache de npm y de navegadores Playwright.
- Dependabot para npm y actions, semanal.

**Railway — proyecto `airlink-visitas`**
- Servicios: `Postgres`, `web` (conectado al repo, **Wait for CI** activado), bucket `visitas-media`, `ops/cron` (schedule `*/5 * * * *`, hace `POST $APP_URL/api/cron/tick` con `CRON_SECRET`), `ops/backup` (schedule `0 7 * * *`, `pg_dump` → bucket, retención 30 días).
- `railway.json` del `web`:
  ```json
  { "build": { "builder": "RAILPACK", "buildCommand": "npm run build" },
    "deploy": { "startCommand": "npm run start:prod", "healthcheckPath": "/api/health/ready",
                "healthcheckTimeout": 120, "restartPolicyType": "ON_FAILURE", "numReplicas": 1 } }
  ```
- `start:prod` = `prisma migrate deploy && tsx prisma/seed.ts && next start`. Seed idempotente bajo advisory lock (crea sitios Airlink 2/Airlink 3, puertas, políticas por defecto, NDA v1, admin de emergencia).
- Entorno `staging` además de `production` (Railway environments), desplegado desde rama `develop`.

**Variables** (se ponen en Railway, **nunca** en el chat ni en el repo; `.env.example` lista nombres sin valores):

| Variable | Uso |
|---|---|
| `DATABASE_URL` | referencia a Postgres |
| `APP_URL`, `CANONICAL_HOST` | p. ej. `https://visitas.airlinkdr.com` |
| `APP_ENCRYPTION_KEY`, `PASS_SIGNING_KEY`, `DOC_HASH_KEY`, `SESSION_SECRET` | 32 bytes aleatorios cada una |
| `CRON_SECRET`, `SYNC_SECRET`, `PRINT_AGENT_SECRET`, `TEAMS_ACTION_SECRET` | secretos de integraciones |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | app registration en airlinkdr.com |
| `TEAMS_WEBHOOK_URL` | flujo de Power Automate «Cuando se recibe una solicitud HTTP» |
| `SMTP_*` o `GRAPH_*` | correo |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | bucket |
| `SENTRY_DSN` | errores |
| `SEED_ADMIN_EMAIL` | admin de emergencia |
| `SPN_SQL_URL` *(solo si Railway alcanza SPN; si no, el agente local)* | directorio |
| Fase 2: `FCM_SERVICE_ACCOUNT_JSON`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | |
| Fase 3: `ANTHROPIC_API_KEY`, `MQTT_URL` | |

**Dominio:** `visitas.airlinkdr.com` en Cloudflare (proxied, SSL Full) → dominio personalizado en Railway. Confirmar con Jaime si el DNS de airlinkdr.com está en Cloudflare o en el registrador tras la migración M365.

**Entra ID:** app registration «Airlink Visitas» (web, redirect `https://visitas.airlinkdr.com/api/auth/callback/microsoft-entra-id` y la de localhost), permisos `openid profile email User.Read`; opcional `User.Read.All` con app-only para el sync de usuarios. Jaime la crea en el portal; Claude Code solo pide los tres valores.

**App nativa (después):** `mobile/` con Capacitor 8 cargando el dominio. Distribución interna (Apple Business / Google internal testing) para seguridad y anfitriones.

---

## 12. Pruebas mínimas

**Unitarias (Vitest)**
- Firma/verificación del QR, ventanas y horarios recurrentes (medianoche, zona horaria).
- `uses` atómico, hash de cédula, reglas de lista negra, evaluación de `VisitPolicy`.
- Generación ZPL del gafete (snapshot).
- Parser del sync de SPN (filas con columnas invertidas, nulos, fotos vacías).

**E2E (Playwright, `locale: es-DO`)**
- Anfitrión invita → seguridad escanea → entrada → gafete → salida.
- Contratista requiere aprobación de Seguridad → aprobar → QR válido; sin aprobar → rojo.
- No anunciado → notificación falsa (`NOTIFY_FAKE=1`) → aprobar desde `/app`.
- Pase vencido/usado → rojo. Lista negra → bloqueo y alerta.
- NDA requerido y no aceptado → rojo con instrucción; aceptar en `/v/<token>` → verde.
- Aislamiento entre sitios: seguridad de Airlink 2 no ve ni valida pases de Airlink 3 (salvo pases con `gateIds` de ambos).
- Offline: escanear sin red → reconectar → entrada registrada una sola vez.
- Lista de evacuación refleja exactamente las visitas `inside`/`at_dock`.
- Responsive de 280 px a escritorio; kiosco en tablet 10" horizontal sin desbordes.

---

## 13. Plan de ejecución para Claude Code

Trabaja en este orden. En cada paso: commit en inglés, PR, CI verde, merge. No hagas push directo a `main`. Si algo requiere una credencial o una decisión de Jaime, **detente y pregunta**; no inventes valores.

### Paso 0 — Verificar herramientas
```bash
gh auth status            # GitHub
railway whoami            # Railway
node -v && npm -v         # Node 22 LTS
```
Si Fitness Together está accesible localmente, ubica su repo (`~/…/fitness-together`) para copiar `src/lib/auth/*` (sesiones, PIN, TOTP), `src/lib/notifications/*`, `src/lib/media/putFile.ts`, `buildCsp`, `withAdvisoryLock`, `audit()`, i18n helpers y la configuración de Playwright/CI. Si no está accesible, implementa equivalentes con las mismas interfaces descritas en el `CLAUDE.md`.

### Paso 1 — Repo
```bash
gh repo create virgax/airlink-visitas --private --clone
cd airlink-visitas
npx create-next-app@latest . --ts --tailwind --app --src-dir --import-alias "@/*" --no-eslint   # luego añadir eslint config propio
npm i prisma @prisma/client next-intl zod lucide-react web-push next-auth@beta @auth/prisma-adapter @zxing/browser
npm i -D vitest @playwright/test tsx @types/web-push
```
- Crear `CLAUDE.md` (sección 14), `.env.example`, `README.md`, `.github/workflows/ci.yml`, `railway.json`, `prisma/schema.prisma` (sección 7), `prisma/seed.ts`.
- Rama `develop`. Proteger `main` y `develop`:
  ```bash
  gh api -X PUT repos/virgax/airlink-visitas/branches/main/protection --input protection.json
  ```
  (`protection.json`: required status checks `ci`, PR requerido, sin force push.)
- Primer PR: esqueleto + CI verde.

### Paso 2 — Railway
```bash
railway init --name airlink-visitas
railway add --database postgres
railway add --service web          # vincular al repo virgax/airlink-visitas, rama main, root /
railway volume / bucket            # crear bucket visitas-media desde el dashboard o MCP de Railway
```
- Servicios `ops/cron` y `ops/backup` como servicios con `cronSchedule` (Railway cron) usando la misma imagen y comandos `npm run cron:tick` / `npm run ops:backup`.
- Activar **Wait for CI** en `web`.
- Crear environment `staging` ligado a `develop`.
- Pedir a Jaime que cargue las variables de la sección 11 en Railway (imprime la lista de nombres; genera localmente las claves aleatorias con `openssl rand -base64 32` y díselas **solo** como comando para que él lo corra, no las pegues en el chat).
- Verificar `/api/health/ready` y `/api/health/live` en el dominio `*.up.railway.app` antes del dominio custom.

### Paso 3 — Fase 0 (base)
Un solo agente integrador. Entregables: auth Entra + sesiones + PIN kiosco, `Site`/`Membership`, layout con selector de panel, i18n, temas, PWA (manifest, SW, instalable), Sentry, logs estructurados, healthchecks, cron tick con advisory lock, backup. Actualizar `CLAUDE.md` → `Phase 0 ✅`.

### Paso 4 — Fase 1 en rebanadas paralelas (worktrees)
Cada rebanada en su worktree, con su BD (`createdb visitas_<slice>`), su puerto y su QA; un revisor por rebanada; el integrador une, corre la suite completa y regenera capturas de ayuda.

| Rebanada | Rama | Alcance |
|---|---|---|
| A | `feat/sites-directory` | Sitios, puertas, áreas, políticas; directorio `Employee` + sync SPN/Entra + endpoint `/api/sync/employees` + agente local `tools/sync-agent` |
| B | `feat/passes` | Pases, QR firmado, `/v/<token>`, pre-registro, NDA, aprobación de segundo nivel |
| C | `feat/guard` | Modo kiosco: escáner, no anunciados, entrada/salida, muelle, lista de evacuación, offline (IndexedDB + `scanId`) |
| D | `feat/notifications` | Teams (Power Automate webhook + acciones firmadas), Web Push, correo; `NotificationPref`; escalamiento |
| E | `feat/logs-reports` | Bitácora de turno, reportes, export CSV, reporte de auditoría |

Dependencias: B y C dependen del esquema de A (congelar `schema.prisma` primero en `develop`, luego abrir worktrees).

### Paso 5 — Fase 2 (misma mecánica)
Rebanadas: `feat/badges-zebra` (ZPL + `tools/print-agent`), `feat/recurring-carrier-delivery`, `feat/blacklist-companies`, `feat/shifts-incidents`, `feat/export-pdf`, `feat/airlinkcast-lobby`.

### Paso 6 — Documentación para Airlink
Generar en `docs/`: SOP borrador «Control de Visitantes» (estructura compatible con el estándar Airlink: cajetín, grises, numeración pendiente de Document Control), guía rápida para seguridad (una página, con capturas), guía para anfitriones (Teams + web), y `docs/RUNBOOK.md` (deploy, rollback, restaurar backup, rotar claves, enrolar dispositivo kiosco).

### Reglas durante toda la ejecución
- Pregunta antes de: crear recursos facturables nuevos, cambiar DNS, borrar datos, tocar SPN de cualquier forma que no sea lectura.
- Nunca pidas ni repitas secretos en el chat. Nunca los escribas en archivos versionados.
- Textos de UI en español (RD, «tú»); código, identificadores, tablas y commits en inglés.
- Reporta al final de cada fase: qué se desplegó, URL, cobertura de pruebas, pendientes y decisiones que necesiten a Jaime o a Victor.

---

## 14. `CLAUDE.md` inicial para el repo

```markdown
# CLAUDE.md — Airlink Visitas (visitor management for Airlink Distribution DR)

## Product
Visitor control for an electronics refurbishment plant in Santo Domingo. Hosts are employees; visitors are
vendors, contractors, carriers, client auditors (Assurant/AT&T/Samsung), candidates and couriers. Security/reception
validates signed QR passes at a kiosk, prints badges, keeps an evacuation list and an auditable log.

## Conventions
- UI text in Spanish (DR neutral, "tú"); code, identifiers, tables, commits in English. next-intl, `es` source + `en`;
  never hardcode UI text; ICU plurals; `fmtDate`/`fmtNumber` with the UI locale.
- Multi-site by `Site`: every query filters by `siteId` from `requireMembership(role)` (`admin|security|approver|host`;
  `admin` with `siteId = null` sees all sites). Ids from the browser (pass, visit, employee, gate) are re-checked
  against that site. Never trust form ids.
- Auth: Microsoft Entra ID (OIDC, tenant airlinkdr.com) via Auth.js with DB sessions; JIT user provisioning linked by
  email to `Employee`. Kiosk `/guard`: enrolled `GuardDevice` (HttpOnly device token) + guard PIN; idle lock.
  Local break-glass admin with TOTP only. Session, PIN and TOTP helpers in `src/lib/auth/*` (ported from Fitness Together).
- `Employee` is a read-only mirror of SPN (`spn.dbo.empleados`) + Entra; synced hourly (`src/lib/sync/employees.ts`)
  or pushed by `tools/sync-agent` to `/api/sync/employees` (HMAC `SYNC_SECRET`). Never write to SPN.
- Dates stored UTC; displayed in `Site.timezone` (default America/Santo_Domingo).
- Passes: QR payload `passId.exp.sig` (HMAC `PASS_SIGNING_KEY`, 16-byte base64url); validation only in
  `src/lib/passes/validate.ts` (pure, unit-tested) + atomic `uses` increment in `src/lib/server/passes.ts`.
  Recurring passes show a rotating TOTP QR. Policies (`VisitPolicy`) are data, never hardcoded per kind.
- Identity documents: never store the full number — `docHash` (HMAC `DOC_HASH_KEY`) + `docLast4`; photos private in
  the bucket (`s/<siteId>/visits/…`), served by `/api/media` with an access check, purged after `settings.retentionDays`.
- Guard app works offline: scans queued in IndexedDB, blacklist + evacuation list cached, server dedupes by `Visit.scanId`.
- Badges: ZPL in `src/lib/badges/zpl.ts` (snapshot-tested); printing through `tools/print-agent` (port 9100, HMAC
  `PRINT_AGENT_SECRET`) or Zebra Browser Print. Badge number = `Visit.badgeNo`.
- Notifications: payload = ids + ICU args, rendered in the reader's language. Channels: Teams (Power Automate webhook,
  Adaptive Cards; actions call `/api/teams/action` signed with `TEAMS_ACTION_SECRET`), Web Push, email.
  `visit_at_gate`, `blacklist_hit`, `carrier_at_dock` ignore quiet hours. `NOTIFY_FAKE=1` in tests.
- Uploads through `putFile` (sniffed, re-encoded, metadata stripped). CSP with nonce; no new origins without `buildCsp`.
- Background jobs/cron under `withAdvisoryLock`; no in-memory state across requests (several replicas).
- Audit important events with `audit()` (pass created/approved/revoked, visit approved/denied/entered/left,
  blacklist hit, NDA accepted, policy/settings changed, device enrolled, employee sync).
- Icons: Lucide via `<Icon>`; no emojis in UI. Light/dark via CSS variables; Airlink brand tokens in `src/styles/brand.css`.
- Secrets live only in Railway variables; `.env.example` lists names without values. Never print secrets in chat or files.

## Commands
- `npm run dev` · `build` · `lint` · `typecheck` · `test` · `test:e2e` · `db:migrate` · `db:deploy` · `db:seed`
- `npm run cron:tick` · `npm run ops:backup` · `npm run sync:employees`
- E2E in the Claude container: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`

## Infra
- GitHub `virgax/airlink-visitas`: `main` (production) and `develop` (staging), both protected, PR + CI required.
- Railway project `airlink-visitas`: `web`, `Postgres`, bucket `visitas-media`, cron `ops/cron` (*/5 min),
  `ops/backup` (07:00 UTC). "Wait for CI" on. Healthcheck `/api/health/ready`. Environments `production`/`staging`.
- Domain `visitas.airlinkdr.com` at Cloudflare (proxied, SSL Full).
- Integrations: Entra ID app registration "Airlink Visitas"; Power Automate HTTP flow for Teams; SPN read-only;
  Zebra printers; AirlinkCast lobby screen (phase 2).

## Working method
- Phases are split into slices; each slice runs in its own git worktree with its own DB (`visitas_<slice>`), port and QA,
  plus one reviewer per slice. The integrator merges into `develop`, runs the full suite, regenerates help screenshots,
  then PRs `develop` → `main`.
- Stop and ask Jaime before: creating billable resources, DNS changes, deleting data, anything touching SPN beyond reads.

## Phase status
- Phase 0 ⏳ repo, infra, auth (Entra + kiosk PIN), multi-site, PWA, CI.
- Phase 1 ⏳ sites/directory, passes + QR, guard kiosk + offline, notifications, logs/reports.
- Phase 2 · badges, recurring/carrier/delivery, blacklist, shifts, PDF, AirlinkCast.
- Phase 3 · AI doc/plate reading, access hardware, self-service kiosk.
```

---

## 15. Decisiones pendientes de Jaime (preguntar antes de empezar)

1. ¿Nombre final del producto y subdominio? (propuesto `visitas.airlinkdr.com`)
2. ¿Sitios iniciales exactos y puertas de cada uno? (propuesto: Airlink 2 — Recepción, Muelle; Airlink 3 — Recepción; New Airlink 2 cuando abra)
3. ¿Railway puede alcanzar SPN (SQL Server) o va el agente local en el file server?
4. ¿Teams vía Power Automate (sin licencia extra de bot) o bot de Azure? (propuesto: Power Automate)
5. ¿Impresoras Zebra disponibles en recepción? Modelo y si están en red (puerto 9100).
6. ¿Quién aprueba contratistas y auditores: Seguridad, el jefe de área, o ambos?
7. ¿Texto del NDA / política de visitantes vigente (hay una en Documentación/RRHH)?
8. ¿Retención de fotos de cédula: 90 días, o lo que exijan los clientes?
