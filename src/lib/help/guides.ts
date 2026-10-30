/**
 * Step-by-step guides shown under /help. Texts live in messages/*.json (`help.guides.<slug>`), screenshots in
 * public/help/<shot>.png, regenerated with `npm run help:screenshots` against a seeded local server.
 */
export type HelpAudience = "admin" | "security" | "host" | "approver" | "warden" | "hr";

export type HelpStep = {
  /** i18n key under help.guides.<slug>.steps */
  key: string;
  /** File name (without extension) under public/help; omitted for steps without a screen. */
  shot?: string;
  /** Capture the screenshot at kiosk (tablet) size instead of desktop. */
  kiosk?: boolean;
};

export type HelpGuide = {
  slug: string;
  icon: "kiosk" | "scan" | "pass" | "approve" | "settings" | "people" | "form" | "report" | "siren" | "account";
  audience: HelpAudience[];
  steps: HelpStep[];
  related?: string[];
};

export const HELP_AUDIENCES: readonly HelpAudience[] = ["admin", "security", "host", "approver", "warden", "hr"];

export const HELP_GUIDES: readonly HelpGuide[] = [
  {
    slug: "kiosk-setup",
    icon: "kiosk",
    audience: ["admin", "security"],
    steps: [
      { key: "guardPin", shot: "admin-people-add" },
      { key: "device", shot: "admin-devices-create" },
      { key: "code", shot: "admin-devices-code" },
      { key: "enroll", shot: "kiosk-enroll", kiosk: true },
      { key: "pin", shot: "kiosk-pin", kiosk: true },
      { key: "home", shot: "kiosk-home", kiosk: true },
      { key: "install" },
      { key: "printer" },
      { key: "checkpoint", shot: "admin-gate-checkpoint" },
    ],
    related: ["kiosk-daily", "admin-people"],
  },
  {
    slug: "kiosk-daily",
    icon: "scan",
    audience: ["security"],
    steps: [
      { key: "scan", shot: "kiosk-scan", kiosk: true },
      { key: "result", shot: "kiosk-scan-result", kiosk: true },
      { key: "badge", shot: "kiosk-badge", kiosk: true },
      { key: "pin", shot: "kiosk-scan-pin", kiosk: true },
      { key: "unannounced", shot: "kiosk-unannounced", kiosk: true },
      { key: "inside", shot: "kiosk-inside", kiosk: true },
      { key: "evacuation", shot: "kiosk-evacuation", kiosk: true },
      { key: "log", shot: "kiosk-log", kiosk: true },
      { key: "checkpoint", shot: "kiosk-checkpoint", kiosk: true },
      { key: "offline" },
      { key: "lock" },
    ],
    related: ["kiosk-setup", "evacuation"],
  },
  {
    slug: "host-passes",
    icon: "pass",
    audience: ["host"],
    steps: [
      { key: "home", shot: "host-home" },
      { key: "new", shot: "host-pass-new" },
      { key: "selfRegister", shot: "visitor-register" },
      { key: "onBehalf", shot: "host-pass-new-behalf" },
      { key: "detail", shot: "host-pass-detail" },
      { key: "visitor", shot: "visitor-link" },
      { key: "pending", shot: "visitor-pending" },
      { key: "arrival" },
    ],
    related: ["approvals", "account"],
  },
  {
    slug: "approvals",
    icon: "approve",
    audience: ["approver", "security", "host"],
    steps: [
      { key: "list", shot: "host-approvals" },
      { key: "decide" },
      { key: "unannounced" },
    ],
    related: ["host-passes", "kiosk-daily"],
  },
  {
    slug: "admin-setup",
    icon: "settings",
    audience: ["admin"],
    steps: [
      { key: "panels", shot: "select-panel" },
      { key: "sites", shot: "admin-site" },
      { key: "policies", shot: "admin-policies" },
      { key: "nda", shot: "admin-nda" },
      { key: "sitesDelete" },
      { key: "companies", shot: "admin-companies" },
      { key: "frequent", shot: "admin-frequent" },
      { key: "devices" },
    ],
    related: ["kiosk-setup", "admin-people", "admin-forms"],
  },
  {
    slug: "admin-people",
    icon: "people",
    audience: ["admin"],
    steps: [
      { key: "directory", shot: "admin-people" },
      { key: "add", shot: "admin-people-add" },
      { key: "roles" },
      { key: "pin" },
      { key: "deactivate" },
    ],
    related: ["kiosk-setup", "admin-setup"],
  },
  {
    slug: "admin-forms",
    icon: "form",
    audience: ["admin", "hr"],
    steps: [
      { key: "list", shot: "admin-forms" },
      { key: "editor", shot: "admin-form-editor" },
      { key: "contractor", shot: "admin-form-contractor" },
      { key: "assign", shot: "admin-policies-form" },
      { key: "result" },
    ],
    related: ["admin-setup", "host-passes"],
  },
  {
    slug: "reports",
    icon: "report",
    audience: ["admin", "security"],
    steps: [
      { key: "overview", shot: "admin-reports" },
      { key: "export" },
      { key: "signIn", shot: "admin-sign-in" },
      { key: "audit", shot: "admin-report-audit" },
      { key: "shifts" },
    ],
    related: ["kiosk-daily"],
  },
  {
    slug: "evacuation",
    icon: "siren",
    audience: ["warden", "security", "admin"],
    steps: [
      { key: "list", shot: "warden-evacuation" },
      { key: "rollCall" },
      { key: "send" },
      { key: "kiosk", shot: "kiosk-evacuation", kiosk: true },
    ],
    related: ["kiosk-daily", "admin-people"],
  },
  {
    slug: "account",
    icon: "account",
    audience: ["admin", "security", "host", "approver", "warden", "hr"],
    steps: [
      { key: "account", shot: "account" },
      { key: "notifications", shot: "account-notifications" },
      { key: "language" },
    ],
    related: ["host-passes"],
  },
];

export function findGuide(slug: string): HelpGuide | undefined {
  return HELP_GUIDES.find((g) => g.slug === slug);
}

/** Every distinct screenshot referenced by the guides (used by the capture script and the tests). */
export function helpShots(): { shot: string; kiosk: boolean }[] {
  const seen = new Map<string, boolean>();
  for (const g of HELP_GUIDES) for (const s of g.steps) if (s.shot && !seen.has(s.shot)) seen.set(s.shot, !!s.kiosk);
  return [...seen].map(([shot, kiosk]) => ({ shot, kiosk }));
}
