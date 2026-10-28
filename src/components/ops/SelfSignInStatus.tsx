"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, LogIn, XCircle } from "lucide-react";
import { Icon } from "@/components/Icon";

export type SelfVisitStatus = "pending" | "approved" | "denied" | "inside" | "at_dock" | "left" | "timeout";

export type SelfVisitJson = { id: string; status: SelfVisitStatus; visitorName: string; hostName: string | null; gateName: string };

export type SelfSignInStatusLabels = Record<SelfVisitStatus, { title: string; body: string }> & { network: string };

const POLL_MS = 4_000;

/** Visitor-facing status of a self sign-in visit, polled every 4 s until it is decided and entered. */
export function SelfSignInStatus({ initial, pollUrl, labels }: { initial: SelfVisitJson; pollUrl: string; labels: SelfSignInStatusLabels }) {
  const [visit, setVisit] = useState<SelfVisitJson>(initial);
  const [error, setError] = useState(false);

  useEffect(() => {
    const settled = visit.status === "denied" || visit.status === "left" || visit.status === "timeout";
    if (settled) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(pollUrl, { cache: "no-store" });
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = (await res.json()) as { ok: boolean; visit?: SelfVisitJson };
        if (data.ok && data.visit) {
          setVisit(data.visit);
          setError(false);
        }
      } catch {
        setError(true);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pollUrl, visit.status]);

  const tone =
    visit.status === "approved" || visit.status === "inside" || visit.status === "at_dock" ? "bg-success-bg text-success"
    : visit.status === "denied" || visit.status === "timeout" ? "bg-danger-bg text-danger"
    : "bg-warning-bg text-warning";
  const icon =
    visit.status === "approved" ? CheckCircle2
    : visit.status === "inside" || visit.status === "at_dock" ? LogIn
    : visit.status === "denied" || visit.status === "timeout" || visit.status === "left" ? XCircle
    : Clock;
  const text = labels[visit.status];

  return (
    <div className="space-y-3" data-testid="self-status" data-status={visit.status}>
      <div className={`flex items-start gap-3 rounded-lg px-4 py-3 ${tone}`} role="status" aria-live="polite">
        <Icon icon={icon} size={24} />
        <div>
          <p className="text-lg font-semibold">{text.title}</p>
          <p className="text-sm">{text.body}</p>
        </div>
      </div>
      {error ? <p className="alert-error">{labels.network}</p> : null}
    </div>
  );
}
