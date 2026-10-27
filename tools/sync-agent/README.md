# sync-agent — employee directory push

Small Node script (no dependencies, Node 20+) that runs on a machine inside Airlink's network, reads the employee
directory from SPN and pushes it to Airlink Visitas (`POST /api/sync/employees`). Use it when Railway cannot reach
SPN directly. It never writes to SPN.

## Setup

1. Copy this folder to the file server (or any host with Node 20+ and network access to SPN and to `visitas.airlinkdr.com`).
2. Set two environment variables (Windows: *System Properties → Environment Variables*, or a `.cmd` wrapper):
   - `VISITAS_URL` — `https://visitas.airlinkdr.com` (staging: the Railway staging URL)
   - `SYNC_SECRET` — the same value as the `SYNC_SECRET` Railway variable (ask IT; never commit it)
3. Test with a file export first:

   ```
   node index.mjs --file rows.json --dry-run
   node index.mjs --file rows.json
   ```

   `rows.json` is a JSON array of objects (or `{ "rows": [...] }`). Column names are matched loosely:
   `codigo|id`, `nombre|name`, `departamento|department`, `extension|ext`, `correo|email`, `telefono|phone`,
   `activo|estado|status`, `foto|photo`, `sitio|site`. Nulls, `"NULL"` and empty photos are fine.

4. Schedule it hourly with Task Scheduler (`node C:\sync-agent\index.mjs --full`).

## Flags

| Flag | Meaning |
|---|---|
| `--file <path>` | Read rows from a JSON file instead of SPN |
| `--full` | The payload is the complete directory: employees missing from it are marked inactive (never deleted) |
| `--source spn\|entra` | Stored in `Employee.source` (default `spn`) |
| `--dry-run` | Build and sign the payload without sending it |

## SPN (SQL Server) — TODO

`readFromSpn` in `index.mjs` is a placeholder. To enable it: `npm install mssql` in this folder, set `SPN_SQL_URL`
(`mssql://user:password@host/spn`, a **read-only** login), and run the agreed query:

```sql
SELECT codigo, nombre, departamento, extension, correo, telefono, activo, foto
FROM spn.dbo.empleados
```

Send `foto` as base64 or null. Run with `--full` so people who left SPN are deactivated in Visitas.

## How the request is authenticated

The body is JSON `{ rows, full, source }`. The header `x-signature` carries the hex HMAC-SHA256 of the exact body
bytes with `SYNC_SECRET`. The server rejects bad signatures (401), rate-limits by IP (429), refuses more than 20,000 rows
and replies with counts: `created`, `updated`, `deactivated`, `skipped`, `rejected` (plus the rejection reasons, never
the rows themselves). Every run is audited as `employee.synced`.
