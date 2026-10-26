# Airlink Visitas

Control de visitantes para Airlink Distribution DR: los empleados invitan, el visitante llega con un pase QR,
seguridad lo valida en el kiosco, imprime el gafete y todo queda en bitácora auditable.

Brief completo del producto y plan de fases: [`docs/PLAN.md`](docs/PLAN.md). Convenciones para desarrollar: [`CLAUDE.md`](CLAUDE.md).

## Stack
Next.js 15 (App Router) · TypeScript · Prisma 6 · Postgres · Tailwind 4 · next-intl · Zod · Vitest · Playwright · Railway.

## Desarrollo local
```bash
cp .env.example .env            # completa DATABASE_URL y las claves (openssl rand -base64 32)
npm install
npx prisma migrate dev          # crea la BD y aplica migraciones
npm run db:seed                 # sitios Airlink 2 / Airlink 3, políticas, NDA v1, admin local
npm run dev                     # http://localhost:3000
```
Entra con `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (cuenta local de emergencia) o con Microsoft si `ENTRA_*` está configurado.

## Pruebas
```bash
npm run lint && npm run typecheck && npm test
npm run build && npm run test:e2e   # Playwright levanta `npm run start` y usa la BD de DATABASE_URL
```

## Paneles
| Ruta | Rol |
|---|---|
| `/admin` | Administración (IT, Seguridad, RRHH) |
| `/app` | Anfitrión (empleado) · `/app/approvals` aprobador |
| `/guard` | Kiosco de seguridad (dispositivo enrolado + PIN) |
| `/v/<token>` | Pase público del visitante |

## Despliegue
Railway `airlink-visitas` con `railway.json`: `npm run build`, `npm run start:prod` (migra, siembra y arranca),
healthcheck `/api/health/ready`. Variables en Railway, nunca en el repo.
