import "server-only";
import type { FormTemplate, Prisma, VisitKind } from "@prisma/client";
import { db } from "@/lib/db";
import type { Tenant } from "@/lib/auth/guards";
import { resolveForm, type FormElement, type ResolvedForm } from "@/lib/forms/schema";
import type { PolicyInput } from "@/lib/policies/evaluate";

export type LoadedForm = { policy: PolicyInput | null; form: ResolvedForm };

/** The policy row of a kind and the sign-in form that applies to it (template → inline → default). */
export async function loadPolicyAndForm(siteId: string, kind: VisitKind): Promise<LoadedForm> {
  const row = await db.visitPolicy.findUnique({ where: { siteId_kind: { siteId, kind } }, include: { formTemplate: true } });
  if (!row) return { policy: null, form: resolveForm(kind, null) };
  const { id: _id, siteId: _s, formTemplate, ...policy } = row;
  // A template of another site must never apply here (ids are validated on save, but the row can be edited).
  const template = formTemplate && (formTemplate.siteId === null || formTemplate.siteId === siteId) ? formTemplate : null;
  return { policy, form: resolveForm(kind, policy, template) };
}

/** Forms of every kind at a site, for pages that render all kinds at once (host invite, kiosk). */
export async function loadFormsForSite(siteId: string): Promise<Record<VisitKind, LoadedForm>> {
  const rows = await db.visitPolicy.findMany({ where: { siteId }, include: { formTemplate: true } });
  const kinds: VisitKind[] = ["visit", "candidate", "contractor", "vendor", "auditor", "carrier", "delivery", "recurring"];
  const out = {} as Record<VisitKind, LoadedForm>;
  for (const kind of kinds) {
    const row = rows.find((r) => r.kind === kind);
    if (!row) {
      out[kind] = { policy: null, form: resolveForm(kind, null) };
      continue;
    }
    const { id: _id, siteId: _s, formTemplate, ...policy } = row;
    const template = formTemplate && (formTemplate.siteId === null || formTemplate.siteId === siteId) ? formTemplate : null;
    out[kind] = { policy, form: resolveForm(kind, policy, template) };
  }
  return out;
}

/** Elements of every kind for one surface, as a plain map the client-side kind switch can read. */
export function elementsByKind(forms: Record<VisitKind, LoadedForm>): Record<VisitKind, FormElement[]> {
  return Object.fromEntries(Object.entries(forms).map(([k, v]) => [k, v.form.elements])) as Record<VisitKind, FormElement[]>;
}

/** Templates an admin may use at a site: that site's plus the shared ones (siteId null). */
export function templateWhereForSite(siteId: string): Prisma.FormTemplateWhereInput {
  return { OR: [{ siteId }, { siteId: null }] };
}

/** Templates an admin may manage: all for all-sites admins, otherwise their sites' plus the shared ones (read-only for them). */
export function templateWhereForTenant(tenant: Tenant): Prisma.FormTemplateWhereInput {
  if (tenant.membership.siteId === null) return {};
  return { OR: [{ siteId: { in: tenant.sites.map((s) => s.id) } }, { siteId: null }] };
}

/** Whether the tenant may edit a template: shared templates belong to all-sites admins only. */
export function canEditTemplate(tenant: Tenant, template: Pick<FormTemplate, "siteId">): boolean {
  if (tenant.membership.siteId === null) return true;
  return template.siteId !== null && tenant.sites.some((s) => s.id === template.siteId);
}

/** Site segment of media keys for a template: its site, or `all` for shared templates. */
export function templateMediaSite(template: Pick<FormTemplate, "siteId">): string {
  return template.siteId ?? "all";
}
