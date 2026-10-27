import { describe, expect, it } from "vitest";
import { defaultUrl, icuArgs, renderNotification } from "@/lib/notifications/render";
import { NOTIFICATION_TYPES } from "@/lib/notifications/types";
import es from "../messages/es.json";
import en from "../messages/en.json";

const payload = {
  visitId: "v1",
  passId: "p1",
  visitorName: "Juan Pérez",
  company: "Uptime",
  gateName: "Recepción",
  hostName: "María Gómez",
  siteName: "Airlink 2",
  plate: "A123456",
  reason: "Incidente previo",
  date: "2026-10-26",
  minutes: 95,
  maxMinutes: 60,
  count: 3,
};

describe("renderNotification", () => {
  it("has ICU messages for every type in both locales", () => {
    for (const locale of ["es", "en"] as const) {
      const types = (locale === "es" ? es : en).notifications.types as Record<string, { title: string; body: string }>;
      for (const type of NOTIFICATION_TYPES) {
        expect(types[type]?.title, `${locale}.${type}.title`).toBeTruthy();
        expect(types[type]?.body, `${locale}.${type}.body`).toBeTruthy();
      }
    }
  });

  it("renders every type in es and en without leaking ICU syntax", () => {
    for (const locale of ["es", "en"] as const) {
      for (const type of NOTIFICATION_TYPES) {
        const r = renderNotification(type, payload, locale);
        expect(r.title, `${locale}.${type}`).not.toMatch(/[{}]/);
        expect(r.body, `${locale}.${type}`).not.toMatch(/[{}]/);
        expect(r.title.length).toBeGreaterThan(3);
        expect(r.url.startsWith("/")).toBe(true);
      }
    }
  });

  it("renders visit_at_gate in Spanish with company and host", () => {
    const r = renderNotification("visit_at_gate", payload, "es");
    expect(r.title).toBe("Visitante en portería");
    expect(r.body).toBe("Juan Pérez (Uptime) está en Recepción y busca a María Gómez. Aprueba o rechaza la visita.");
    expect(r.url).toBe("/app/notifications");
  });

  it("renders the escalated variant and English", () => {
    const r = renderNotification("visit_at_gate", { ...payload, escalated: true }, "en");
    expect(r.title).toBe("No answer: visitor at the gate");
    expect(r.body).toContain("The host did not answer in time.");
  });

  it("omits optional parts when the payload is sparse and never throws", () => {
    const r = renderNotification("visit_at_gate", { visitorName: "Ana", gateName: "Muelle" }, "es");
    expect(r.body).toBe("Ana está en Muelle. Aprueba o rechaza la visita.");
    const empty = renderNotification("visit_left", null, "en");
    expect(empty.title).toBe("Your visitor left");
    expect(empty.body).not.toMatch(/[{}]/);
  });

  it("uses ICU plurals", () => {
    expect(renderNotification("daily_report", { count: 1, siteName: "Airlink 3", date: "hoy" }, "es").body).toBe("1 visita en Airlink 3 el hoy.");
    expect(renderNotification("daily_report", { count: 0, siteName: "Airlink 3", date: "today" }, "en").body).toBe("No visits at Airlink 3 on today.");
    expect(renderNotification("visitor_overstay", payload, "en").body).toContain("95 minutes");
  });

  it("falls back to Spanish for unknown locales and respects payload.url", () => {
    const r = renderNotification("pass_approved", { ...payload, url: "/app/passes/p1?x=1" }, "fr");
    expect(r.title).toBe("Pase aprobado");
    expect(r.url).toBe("/app/passes/p1?x=1");
    expect(renderNotification("pass_approved", { ...payload, url: "https://evil.example" }, "es").url).toBe("/app/passes/p1");
  });

  it("derives default deep links per type", () => {
    expect(defaultUrl("pass_pending_approval", {})).toBe("/app/approvals");
    expect(defaultUrl("pass_denied", { passId: "abc" })).toBe("/app/passes/abc");
    expect(defaultUrl("evacuation_list", {})).toBe("/guard/evacuation");
    expect(defaultUrl("blacklist_hit", {})).toBe("/app/notifications");
  });

  it("builds ICU args with has* selectors and stringified booleans", () => {
    const args = icuArgs({ company: " ", plate: "X1", escalated: true, nested: { a: 1 } });
    expect(args.hasCompany).toBe("no");
    expect(args.hasPlate).toBe("yes");
    expect(args.escalated).toBe("true");
    expect(args.nested).toBeUndefined();
  });
});
