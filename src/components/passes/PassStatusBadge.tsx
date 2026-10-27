import type { PassStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";

const CLASSES: Record<PassStatus, string> = {
  active: "bg-success-bg text-success",
  pending_approval: "bg-warning-bg text-warning",
  used: "bg-surface-2 text-text-muted",
  revoked: "bg-danger-bg text-danger",
  expired: "bg-surface-2 text-text-muted",
  denied: "bg-danger-bg text-danger",
};

/** Colored pill with the pass status in the UI language. */
export async function PassStatusBadge({ status }: { status: PassStatus }) {
  const t = await getTranslations("passes.status");
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSES[status]}`} data-status={status}>
      {t(status)}
    </span>
  );
}
