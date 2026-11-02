"use server";

import { redirect } from "next/navigation";
import { Prisma, type MembershipRole } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertSiteAllowed, getMembershipOrThrow, type Tenant } from "@/lib/auth/guards";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { assertUserManageable } from "@/lib/server/people-admin";
import { audit } from "@/lib/audit";
import { isEmployeePin, isWeakPin, normalizePin } from "@/lib/people/pin";
import { parseRowKey } from "@/lib/server/people";

const ROLES = ["admin", "security", "approver", "warden"] as const satisfies readonly MembershipRole[];
type ToggleRole = (typeof ROLES)[number];

const isUnique = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Rebuilds the list URL with the filters the form carried (only known keys, so nothing from the browser is echoed blindly). */
function back(formData: FormData, extra: Record<string, string | number>): string {
  const params = new URLSearchParams();
  for (const key of ["q", "tab", "perPage", "page"]) {
    const v = formData.get(key);
    if (typeof v === "string" && v) params.set(key, v.slice(0, 80));
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `/admin/people?${params.toString()}`;
}

const addSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).optional(),
  department: z.string().trim().max(80).optional(),
  extension: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(30).optional(),
  siteId: z.string().max(64).optional(),
  pin: z.string().max(20).optional(),
});

/** Creates a manual employee and, when roles are ticked, the local user that holds them. */
export async function addPersonAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(back(formData, { error: "invalid" }));
  const { name, department, extension, phone } = parsed.data;
  const email = parsed.data.email ? parsed.data.email : null;
  const siteId = parsed.data.siteId ? parsed.data.siteId : null;
  if (siteId) assertSiteAllowed(tenant, siteId);
  if (!siteId && tenant.membership.siteId !== null) redirect(back(formData, { error: "forbidden" }));
  const roles = formData.getAll("roles").map(String).filter((r): r is ToggleRole => (ROLES as readonly string[]).includes(r));
  const pin = normalizePin(parsed.data.pin);
  if (parsed.data.pin?.trim() && !isEmployeePin(pin)) redirect(back(formData, { error: "pin" }));
  if (pin && isWeakPin(pin)) redirect(back(formData, { error: "weakPin" }));
  if ((roles.length || pin) && !email) redirect(back(formData, { error: "needEmail" }));
  const pinHash = pin ? await hashPassword(pin) : null;

  try {
    const employee = await db.employee.create({ data: { name, email, department: department || null, extension: extension || null, phone: phone || null, siteId, source: "manual", pinHash } });
    await audit({ action: "employee.changed", siteId, actorId: tenant.user.id, targetType: "Employee", targetId: employee.id, meta: { op: "created", via: "people" } });
    if (pinHash) await audit({ action: "employee.pin_set", siteId, actorId: tenant.user.id, targetType: "Employee", targetId: employee.id });
    if (roles.length && email) {
      // Never re-link or re-key an existing account from here (that would let a site admin take over any user).
      const taken = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (taken) {
        await db.employee.delete({ where: { id: employee.id } }).catch(() => undefined);
        redirect(back(formData, { error: "exists" }));
      }
      const user = await db.user.create({ data: { email, name, employeeId: employee.id, ...(pinHash ? { pinHash } : {}) } });
      for (const role of roles) {
        const existing = await db.membership.findFirst({ where: { userId: user.id, role, siteId } });
        if (existing) continue;
        await db.membership.create({ data: { userId: user.id, role, siteId } });
        await audit({ action: "member.added", siteId, actorId: tenant.user.id, targetType: "User", targetId: user.id, meta: { role } });
      }
    }
  } catch (err) {
    if (isUnique(err)) redirect(back(formData, { error: "exists" }));
    throw err;
  }
  redirect(back(formData, { ok: "added" }));
}

type Row = { employeeId: string | null; userId: string | null; email: string | null; name: string; siteId: string | null };

/** Resolves a posted row key to its employee / user, re-checking the site. */
async function loadRow(tenant: Tenant, formData: FormData): Promise<Row> {
  const key = parseRowKey(formData.get("key"));
  if (!key) redirect(back(formData, { error: "invalid" }));
  if (key.kind === "emp") {
    const e = await db.employee.findUnique({ where: { id: key.id }, select: { id: true, email: true, name: true, siteId: true, user: { select: { id: true } } } });
    if (!e) redirect(back(formData, { error: "invalid" }));
    if (e.siteId) assertSiteAllowed(tenant, e.siteId);
    if (e.user) await assertUserManageable(tenant, e.user.id);
    return { employeeId: e.id, userId: e.user?.id ?? null, email: e.email, name: e.name, siteId: e.siteId };
  }
  const u = await db.user.findUnique({ where: { id: key.id }, select: { id: true, email: true, name: true, employeeId: true } });
  if (!u) redirect(back(formData, { error: "invalid" }));
  await assertUserManageable(tenant, u.id);
  return { employeeId: u.employeeId, userId: u.id, email: u.email, name: u.name, siteId: null };
}

/** Inline role chip: adds the membership for the admin's active site (or every site), or disables/re-enables it. */
export async function toggleRoleAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const role = String(formData.get("role") ?? "");
  if (!(ROLES as readonly string[]).includes(role)) redirect(back(formData, { error: "invalid" }));
  const row = await loadRow(tenant, formData);
  if (!row.email) redirect(back(formData, { error: "noEmail" }));
  // Scope: the site the admin is working on; a company-wide admin with no site selected grants every site.
  const siteId = tenant.site?.id ?? null;
  if (!siteId && tenant.membership.siteId !== null) redirect(back(formData, { error: "forbidden" }));

  let userId = row.userId;
  if (!userId) {
    const user = await db.user.upsert({ where: { email: row.email }, create: { email: row.email, name: row.name, employeeId: row.employeeId }, update: { employeeId: row.employeeId ?? undefined } });
    userId = user.id;
  }
  const existing = await db.membership.findFirst({ where: { userId, role: role as ToggleRole, siteId } });
  if (existing && existing.status === "active") {
    if (role === "admin" && userId === tenant.user.id) redirect(back(formData, { error: "self" }));
    await db.membership.update({ where: { id: existing.id }, data: { status: "disabled" } });
    await audit({ action: "member.disabled", siteId, actorId: tenant.user.id, targetType: "User", targetId: userId, meta: { role } });
    redirect(back(formData, { ok: "roleOff" }));
  }
  if (existing) await db.membership.update({ where: { id: existing.id }, data: { status: "active" } });
  else await db.membership.create({ data: { userId, role: role as ToggleRole, siteId } });
  await audit({ action: "member.added", siteId, actorId: tenant.user.id, targetType: "User", targetId: userId, meta: { role, reenabled: Boolean(existing) } });
  redirect(back(formData, { ok: "roleOn" }));
}

/** Sets or resets the PIN: `Employee.pinHash` (mirrored to the linked user so the kiosk PIN is the same one). */
export async function setPinAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  // Posted from the list (filters carried) or from the edit page (`return=edit`).
  const key = String(formData.get("key") ?? "");
  const done = (extra: Record<string, string>) => (formData.get("return") === "edit" ? editBack(key, extra) : back(formData, extra));
  const row = await loadRow(tenant, formData);
  const pin = normalizePin(formData.get("pin"));
  if (!isEmployeePin(pin)) redirect(done({ error: "pin" }));
  if (isWeakPin(pin)) redirect(done({ error: "weakPin" }));
  const pinHash = await hashPassword(pin);
  if (row.employeeId) await db.employee.update({ where: { id: row.employeeId }, data: { pinHash } });
  if (row.userId) await db.user.update({ where: { id: row.userId }, data: { pinHash } });
  await audit({ action: "employee.pin_set", siteId: row.siteId, actorId: tenant.user.id, targetType: row.employeeId ? "Employee" : "User", targetId: row.employeeId ?? row.userId ?? undefined, meta: { mirroredToUser: Boolean(row.userId && row.employeeId) } });
  redirect(done({ ok: "pinSet" }));
}

async function setActive(tenant: Tenant, row: Row, active: boolean): Promise<void> {
  if (row.employeeId) {
    await db.employee.update({ where: { id: row.employeeId }, data: { active } });
    await audit({ action: "employee.changed", siteId: row.siteId, actorId: tenant.user.id, targetType: "Employee", targetId: row.employeeId, meta: { op: active ? "activated" : "deactivated", via: "people" } });
  }
  if (row.userId && (!row.employeeId || !active)) {
    // Deactivating a person also closes their user; a user-only row toggles its status.
    if (row.userId === tenant.user.id && !active) return;
    await db.user.update({ where: { id: row.userId }, data: { status: active ? "active" : "disabled" } });
    if (!active) await db.session.deleteMany({ where: { userId: row.userId } });
    await audit({ action: active ? "member.added" : "member.disabled", siteId: row.siteId, actorId: tenant.user.id, targetType: "User", targetId: row.userId, meta: { op: active ? "user_enabled" : "user_disabled" } });
  }
}

/** Single-row activate / deactivate. SPN and Entra rows are never deleted, only deactivated. */
export async function toggleActiveAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const row = await loadRow(tenant, formData);
  const active = formData.get("active") === "1";
  await setActive(tenant, row, active);
  redirect(back(formData, { ok: "saved" }));
}

/** Bulk select → deactivate. */
export async function bulkDeactivateAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const keys = formData.getAll("ids").map(parseRowKey).filter((k): k is NonNullable<typeof k> => k !== null).slice(0, 500);
  if (keys.length === 0) redirect(back(formData, { error: "nothing" }));
  let count = 0;
  for (const key of keys) {
    const fd = new FormData();
    fd.set("key", `${key.kind}:${key.id}`);
    try {
      const row = await loadRow(tenant, fd);
      if (row.userId === tenant.user.id && !row.employeeId) continue;
      await setActive(tenant, row, false);
      count++;
    } catch {
      // a row outside the admin's sites (or vanished): skipped, nothing else is affected
    }
  }
  redirect(back(formData, { ok: "deactivated", count }));
}

// ───────────────────────────── Edit page (/admin/people/edit?key=…) ─────────────────────────────

function editBack(key: string, extra: Record<string, string>): string {
  const params = new URLSearchParams({ key, ...extra });
  return `/admin/people/edit?${params.toString()}`;
}

const editSchema = z.object({
  key: z.string(),
  name: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).optional(),
  department: z.string().trim().max(80).optional(),
  extension: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(30).optional(),
  siteId: z.string().max(64).optional(),
});

/** Edits a manual employee / local user (synced SPN/Entra rows are edited at the source; only their roles, PIN and password here). */
export async function editPersonAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  const key = String(formData.get("key") ?? "");
  if (!parsed.success) redirect(editBack(key, { error: "invalid" }));
  const row = await loadRow(tenant, formData);
  const d = parsed.data;
  const email = d.email ? d.email : null;
  const siteId = d.siteId ? d.siteId : null;
  if (siteId) assertSiteAllowed(tenant, siteId);
  if (!siteId && tenant.membership.siteId !== null) redirect(editBack(key, { error: "forbidden" }));
  if (row.employeeId) {
    const e = await db.employee.findUniqueOrThrow({ where: { id: row.employeeId }, select: { source: true } });
    if (e.source !== "manual") redirect(editBack(key, { error: "synced" }));
  }
  if (row.userId && !email) redirect(editBack(key, { error: "needEmail" }));
  try {
    await db.$transaction(async (tx) => {
      if (row.employeeId) await tx.employee.update({ where: { id: row.employeeId }, data: { name: d.name, email, department: d.department || null, extension: d.extension || null, phone: d.phone || null, siteId } });
      if (row.userId && email) await tx.user.update({ where: { id: row.userId }, data: { name: d.name, email } });
    });
  } catch (err) {
    if (isUnique(err)) redirect(editBack(key, { error: "exists" }));
    throw err;
  }
  await audit({ action: "employee.changed", siteId, actorId: tenant.user.id, targetType: row.employeeId ? "Employee" : "User", targetId: row.employeeId ?? row.userId ?? undefined, meta: { op: "edited", via: "people" } });
  redirect(editBack(key, { ok: "saved" }));
}

/** Adds a role on one site (or every site, company-wide admins only) from the edit page; creates the local user when needed. */
export async function addMembershipAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const key = String(formData.get("key") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!(ROLES as readonly string[]).includes(role)) redirect(editBack(key, { error: "invalid" }));
  const row = await loadRow(tenant, formData);
  if (!row.email) redirect(editBack(key, { error: "noEmail" }));
  const siteRaw = String(formData.get("siteId") ?? "");
  const siteId = siteRaw ? siteRaw : null;
  if (siteId) assertSiteAllowed(tenant, siteId);
  if (!siteId && tenant.membership.siteId !== null) redirect(editBack(key, { error: "forbidden" }));
  let userId = row.userId;
  if (!userId) {
    const taken = await db.user.findUnique({ where: { email: row.email }, select: { id: true } });
    if (taken) redirect(editBack(key, { error: "exists" }));
    userId = (await db.user.create({ data: { email: row.email, name: row.name, employeeId: row.employeeId } })).id;
  }
  const existing = await db.membership.findFirst({ where: { userId, role: role as ToggleRole, siteId } });
  if (existing) await db.membership.update({ where: { id: existing.id }, data: { status: "active" } });
  else await db.membership.create({ data: { userId, role: role as ToggleRole, siteId } });
  await audit({ action: "member.added", siteId, actorId: tenant.user.id, targetType: "User", targetId: userId, meta: { role, via: "edit" } });
  redirect(editBack(key, { ok: "roleOn" }));
}

/** Removes a membership for good (the audit log keeps when it was granted and removed). */
export async function removeMembershipAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const key = String(formData.get("key") ?? "");
  const row = await loadRow(tenant, formData);
  const membershipId = String(formData.get("membershipId") ?? "");
  const m = row.userId ? await db.membership.findFirst({ where: { id: membershipId, userId: row.userId } }) : null;
  if (!m) redirect(editBack(key, { error: "invalid" }));
  if (m.siteId) assertSiteAllowed(tenant, m.siteId);
  else if (tenant.membership.siteId !== null) redirect(editBack(key, { error: "forbidden" }));
  if (m.role === "admin" && row.userId === tenant.user.id) redirect(editBack(key, { error: "self" }));
  await db.membership.delete({ where: { id: m.id } });
  await audit({ action: "member.removed", siteId: m.siteId, actorId: tenant.user.id, targetType: "User", targetId: row.userId!, meta: { role: m.role } });
  redirect(editBack(key, { ok: "roleOff" }));
}

const passwordSchema = z.object({ key: z.string(), password: z.string().min(PASSWORD_MIN_LENGTH).max(200), confirm: z.string().max(200), resetTotp: z.string().optional() });

/**
 * Sets a new password for a local account (creates the account when the person only has an employee row). The
 * person's sessions are closed; the two-step verification can be reset at the same time (lost authenticator).
 */
export async function setPasswordAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const key = String(formData.get("key") ?? "");
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(editBack(key, { error: "password" }));
  if (parsed.data.password !== parsed.data.confirm) redirect(editBack(key, { error: "mismatch" }));
  const row = await loadRow(tenant, formData);
  if (!row.email) redirect(editBack(key, { error: "noEmail" }));
  let userId = row.userId;
  if (!userId) {
    const taken = await db.user.findUnique({ where: { email: row.email }, select: { id: true } });
    if (taken) redirect(editBack(key, { error: "exists" }));
    userId = (await db.user.create({ data: { email: row.email, name: row.name, employeeId: row.employeeId } })).id;
  }
  const resetTotp = parsed.data.resetTotp === "on";
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(parsed.data.password), status: "active", ...(resetTotp ? { totpSecret: null } : {}) } });
  if (userId !== tenant.user.id) await db.session.deleteMany({ where: { userId } });
  await audit({ action: "user.password_reset", siteId: row.siteId, actorId: tenant.user.id, targetType: "User", targetId: userId, meta: { resetTotp } });
  redirect(editBack(key, { ok: "password" }));
}

/**
 * Deletes a manual person (employee row and/or local user). Synced SPN/Entra employees are never deleted (the
 * next sync would bring them back): deactivate them instead. A person with history (passes hosted or created,
 * visits, logs…) cannot be deleted either, so the records keep their author; the error says so.
 */
export async function deletePersonAction(formData: FormData): Promise<void> {
  const tenant = await getMembershipOrThrow("admin");
  const key = String(formData.get("key") ?? "");
  const row = await loadRow(tenant, formData);
  if (row.userId === tenant.user.id) redirect(editBack(key, { error: "self" }));
  if (row.employeeId) {
    const e = await db.employee.findUniqueOrThrow({ where: { id: row.employeeId }, select: { source: true } });
    if (e.source !== "manual") redirect(editBack(key, { error: "synced" }));
  }
  try {
    await db.$transaction(async (tx) => {
      if (row.userId) await tx.user.delete({ where: { id: row.userId } }); // sessions, memberships, notifications cascade
      if (row.employeeId) await tx.employee.delete({ where: { id: row.employeeId } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") redirect(editBack(key, { error: "hasHistory" }));
    throw err;
  }
  await audit({ action: "person.deleted", siteId: row.siteId, actorId: tenant.user.id, targetType: row.employeeId ? "Employee" : "User", targetId: row.employeeId ?? row.userId ?? undefined, meta: { name: row.name, email: row.email } });
  redirect("/admin/people?ok=deleted");
}
