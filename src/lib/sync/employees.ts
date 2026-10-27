/**
 * Employee directory sync (SPN `spn.dbo.empleados` + Entra), Phase 1.
 *
 * `parseEmployeeRows` is pure (unit-tested): it normalizes rows coming from SPN exports, Entra or the local
 * `tools/sync-agent`, tolerating alternate/swapped column names, nulls and empty photos.
 * `upsertEmployees` writes the result into the read-only mirror `Employee`. Nothing here ever writes to SPN.
 */
import type { EmployeeSource, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

export type EmployeeInput = {
  /** SPN employee code. At least one of externalId / email is required. */
  externalId: string | null;
  entraId: string | null;
  email: string | null;
  name: string;
  department: string | null;
  extension: string | null;
  phone: string | null;
  /** Raw photo payload (base64 or URL) when the source sent one; stored later through `putFile`. */
  photo: string | null;
  active: boolean;
  /** Site hint (slug or name) when the source knows the plant. */
  site: string | null;
};

export type RejectedRow = { row: unknown; reason: RejectReason };
export type RejectReason = "not_an_object" | "missing_name" | "missing_identifier";

export type ParseResult = { ok: EmployeeInput[]; rejected: RejectedRow[] };

type Field = keyof EmployeeInput;

/** Accepted column names per field (compared after `normalizeKey`). */
const ALIASES: Record<Field, string[]> = {
  externalId: ["externalid", "codigo", "code", "id", "empleadoid", "idempleado", "employeeid", "empid", "legajo", "numero", "employeenumber", "codigoempleado", "codempleado", "codigodeempleado", "numeroempleado", "noempleado"],
  entraId: ["entraid", "objectid", "oid", "azureid", "aadid"],
  email: ["email", "correo", "mail", "correoelectronico", "userprincipalname", "upn", "emailaddress"],
  name: ["name", "nombre", "nombrecompleto", "fullname", "displayname", "empleado", "nombreempleado"],
  department: ["department", "departamento", "depto", "dept", "area", "dpto"],
  extension: ["extension", "ext", "extensiontelefonica", "exttel"],
  phone: ["phone", "telefono", "tel", "celular", "mobile", "movil", "mobilephone", "businessphones"],
  photo: ["photo", "foto", "imagen", "image", "picture", "fotoempleado"],
  active: ["active", "activo", "estado", "status", "enabled", "accountenabled", "habilitado"],
  site: ["site", "sitio", "sucursal", "planta", "location", "officelocation", "ubicacion"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** lowercases, strips accents, spaces, underscores and dashes so `Correo_Electrónico` matches `correoelectronico`. */
function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_\-.]/g, "");
}

const KEY_TO_FIELD: Map<string, Field> = new Map();
for (const field of Object.keys(ALIASES) as Field[]) {
  for (const alias of ALIASES[field]) if (!KEY_TO_FIELD.has(alias)) KEY_TO_FIELD.set(alias, field);
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return null;
  if (value instanceof Date) return null;
  if (Array.isArray(value)) return str(value[0]);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^(null|undefined|n\/a|nan)$/i.test(trimmed)) return null;
  return trimmed;
}

function cleanText(value: unknown): string | null {
  const s = str(value);
  return s ? s.replace(/\s+/g, " ") : null;
}

function cleanEmail(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const email = s.toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

function cleanPhoto(value: unknown): string | null {
  if (value instanceof Uint8Array) return value.byteLength === 0 ? null : Buffer.from(value).toString("base64");
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // JSON-serialized Node Buffer: { type: "Buffer", data: number[] }
    const obj = value as { type?: unknown; data?: unknown };
    if (obj.type === "Buffer" && Array.isArray(obj.data)) {
      return obj.data.length === 0 ? null : Buffer.from(obj.data as number[]).toString("base64");
    }
    return null;
  }
  const s = str(value);
  if (!s) return null;
  // SQL exports sometimes send "0x" or an empty data URI for NULL images.
  if (/^(0x|data:[^,]*,)?$/i.test(s)) return null;
  return s;
}

function cleanActive(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const s = String(value).trim().toLowerCase();
  if (!s) return true;
  if (["0", "n", "no", "false", "f", "i", "inactivo", "inactiva", "inactive", "disabled", "baja", "off"].includes(s)) return false;
  return true;
}

function looksLikeCode(s: string): boolean {
  return /^[0-9a-z-]{1,20}$/i.test(s) && /\d/.test(s) && !/\s/.test(s);
}

/**
 * Normalizes raw directory rows into `EmployeeInput`s.
 * - Column names are matched case/accent-insensitively against Spanish and English aliases.
 * - Swapped values are repaired when obvious (an email in `name`, a numeric code in `name` with text in `code`).
 * - Nulls, "NULL", empty strings and empty photos become null; `active` defaults to true.
 * - Rows without a name, or without both externalId and email, are rejected with a reason.
 */
export function parseEmployeeRows(rows: unknown[]): ParseResult {
  const ok: EmployeeInput[] = [];
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      rejected.push({ row, reason: "not_an_object" });
      continue;
    }
    const raw: Partial<Record<Field, unknown>> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      const field = KEY_TO_FIELD.get(normalizeKey(key));
      if (field && raw[field] === undefined) raw[field] = value;
    }

    let name = cleanText(raw.name);
    let email = cleanEmail(raw.email);
    let externalId = cleanText(raw.externalId);

    // Swapped columns: email landed in `name` and/or the name in `email`.
    const nameAsEmail = name && EMAIL_RE.test(name) ? name.toLowerCase() : null;
    const emailAsName = cleanText(raw.email);
    if (nameAsEmail && !email) {
      email = nameAsEmail;
      name = emailAsName && !EMAIL_RE.test(emailAsName) ? emailAsName : null;
    }
    // Swapped columns: numeric code in `name` while `code` holds the person's name.
    if (name && externalId && looksLikeCode(name) && !looksLikeCode(externalId) && /\s/.test(externalId)) {
      [name, externalId] = [externalId, name];
    }

    if (!name) {
      rejected.push({ row, reason: "missing_name" });
      continue;
    }
    if (!externalId && !email) {
      rejected.push({ row, reason: "missing_identifier" });
      continue;
    }
    ok.push({
      externalId,
      entraId: cleanText(raw.entraId),
      email,
      name,
      department: cleanText(raw.department),
      extension: cleanText(raw.extension),
      phone: cleanText(raw.phone),
      photo: cleanPhoto(raw.photo),
      active: cleanActive(raw.active),
      site: cleanText(raw.site),
    });
  }
  return { ok, rejected };
}

export type UpsertSummary = { created: number; updated: number; deactivated: number; skipped: number };

export type UpsertOptions = {
  /** Where the rows come from; stored in `Employee.source`. Default `spn`. */
  source?: Exclude<EmployeeSource, "manual">;
  /** When true the payload is the complete directory: employees of this source not present are marked inactive. */
  full?: boolean;
  now?: Date;
};

/**
 * Upserts employees by `externalId` (or `email` when the row has no code). Manual employees that share the email
 * are adopted (linked to the external id) rather than duplicated. With `full: true`, employees of the same source
 * that are missing from the payload are marked inactive; nothing is ever deleted.
 */
export async function upsertEmployees(inputs: EmployeeInput[], opts: UpsertOptions = {}): Promise<UpsertSummary> {
  const source = opts.source ?? "spn";
  const now = opts.now ?? new Date();
  const summary: UpsertSummary = { created: 0, updated: 0, deactivated: 0, skipped: 0 };
  const touched = new Set<string>();

  const sites = await db.site.findMany({ select: { id: true, slug: true, name: true } });
  const siteByKey = new Map<string, string>();
  for (const s of sites) {
    siteByKey.set(normalizeKey(s.slug), s.id);
    siteByKey.set(normalizeKey(s.name), s.id);
  }

  for (const input of inputs) {
    const siteId = input.site ? (siteByKey.get(normalizeKey(input.site)) ?? undefined) : undefined;
    const data: Prisma.EmployeeUncheckedUpdateInput = {
      name: input.name,
      department: input.department,
      extension: input.extension,
      phone: input.phone,
      active: input.active,
      source,
      syncedAt: now,
      ...(input.entraId ? { entraId: input.entraId } : {}),
      ...(siteId ? { siteId } : {}),
      // Photos: stored through `putFile` once the media library lands (private bucket, s/<siteId>/employees/…).
    };

    try {
      let existing = input.externalId ? await db.employee.findUnique({ where: { externalId: input.externalId } }) : null;
      if (!existing && input.email) existing = await db.employee.findUnique({ where: { email: input.email } });

      if (existing) {
        const emailTaken = input.email && input.email !== existing.email ? await db.employee.findUnique({ where: { email: input.email }, select: { id: true } }) : null;
        await db.employee.update({
          where: { id: existing.id },
          data: {
            ...data,
            ...(input.externalId && !existing.externalId ? { externalId: input.externalId } : {}),
            ...(input.email && !emailTaken ? { email: input.email } : {}),
          },
        });
        touched.add(existing.id);
        summary.updated += 1;
      } else {
        const created = await db.employee.create({
          data: { ...(data as Prisma.EmployeeUncheckedCreateInput), name: input.name, externalId: input.externalId, email: input.email },
        });
        touched.add(created.id);
        summary.created += 1;
      }
    } catch (err) {
      summary.skipped += 1;
      log.warn("sync.employees.row_failed", { externalId: input.externalId, err: String(err) });
    }
  }

  if (opts.full) {
    const res = await db.employee.updateMany({
      where: { source, active: true, id: { notIn: [...touched] } },
      data: { active: false, syncedAt: now },
    });
    summary.deactivated = res.count;
  }
  log.info("sync.employees.done", { source, full: Boolean(opts.full), ...summary });
  return summary;
}
