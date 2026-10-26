/**
 * Hourly directory sync (Phase 1). Reads SPN (`spn.dbo.empleados`, read-only) and/or Entra and upserts `Employee`.
 * When Railway cannot reach SPN, `tools/sync-agent` runs on the file server and POSTs to /api/sync/employees.
 */
console.log("sync:employees is implemented in Phase 1 (slice A: feat/sites-directory)");
