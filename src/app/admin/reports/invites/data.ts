import "server-only";
import { getTranslations } from "next-intl/server";
import type { InviteCsvLabels } from "@/lib/server/invites";
import { PASS_STATUSES } from "@/lib/server/invites";
import { VISIT_KINDS } from "@/lib/server/reports-filters";

/** CSV column labels for the invites report in the reader's language. */
export async function inviteCsvLabels(): Promise<InviteCsvLabels> {
  const t = await getTranslations("people.invites");
  const tr = await getTranslations("reports");
  const tp = await getTranslations("passes");
  const c = t.raw("columns") as Record<string, string>;
  return {
    date: c.date!, visitor: c.visitor!, email: c.email!, company: c.company!, host: c.host!, kind: c.kind!, site: c.site!, pin: c.pin!, signedIn: c.signedIn!, enteredAt: c.enteredAt!, status: c.status!, validUntil: c.validUntil!, createdBy: c.createdBy!, frequent: c.frequent!,
    yes: t("filters.yes"),
    no: t("filters.no"),
    kinds: Object.fromEntries(VISIT_KINDS.map((k) => [k, tr(`kinds.${k}`)])),
    statuses: Object.fromEntries(PASS_STATUSES.map((s) => [s, tp(`status.${s}`)])),
  };
}
