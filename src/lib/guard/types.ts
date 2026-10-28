/** Shared shapes between the kiosk client components and the kiosk API routes (no server-only imports here). */
import type { DenyReason } from "@/lib/passes/validate";
import type { VisitJson } from "@/lib/server/visits";

export type PassWarning = "escort" | "nda" | "receptionOnly" | "noBadge";

export type ScanPassInfo = {
  id: string;
  kind: string;
  visitorName: string;
  company: string | null;
  host: string | null;
  hostDepartment: string | null;
  areas: string[];
  warnings: PassWarning[];
  docLast4: string | null;
  plate: string | null;
  /** Custom answers of the sign-in form (host + visitor surfaces). */
  answers?: ScanAnswer[];
};

export type ScanAnswer = { id: string; label: string; value: string | number | boolean };

export type ScanReason = DenyReason | "invalid_body" | "rate_limited" | "network";

export type ScanResponse =
  | { ok: false; reason: ScanReason; pass?: ScanPassInfo }
  | { ok: true; action: "entered" | "left"; duplicate?: boolean; conflict?: boolean; visit: VisitJson; pass: ScanPassInfo };

export type EmployeeHit = { id: string; name: string; department: string | null };
