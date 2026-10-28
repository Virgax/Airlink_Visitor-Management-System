import { describe, expect, it } from "vitest";
import { auditToCsv, csvCell, csvDate, durationMinutes, shiftLogsToCsv, visitsToCsv, type AuditRow, type ShiftLogRow, type VisitRow } from "@/lib/server/reports";
import { filtersToQuery, MAX_RANGE_DAYS, parseShiftLogFilters, parseVisitFilters, rangeToUtc } from "@/lib/server/reports-filters";
import { addDaysYmd, diffDaysYmd, tzOffsetMinutes, zonedStartOfDay } from "@/lib/time/tz";

const TZ = "America/Santo_Domingo"; // UTC-4, no DST
const NOW = new Date("2026-03-10T02:30:00Z"); // 22:30 on March 9 in Santo Domingo

describe("time zone day boundaries", () => {
  it("computes the start of a local day in UTC", () => {
    expect(zonedStartOfDay("2026-03-10", TZ).toISOString()).toBe("2026-03-10T04:00:00.000Z");
    expect(tzOffsetMinutes(NOW, TZ)).toBe(-240);
  });
  it("handles DST transitions", () => {
    // New York switches to EDT on 2026-03-08 at 02:00 local
    expect(zonedStartOfDay("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(zonedStartOfDay("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
  it("does calendar arithmetic on YYYY-MM-DD", () => {
    expect(addDaysYmd("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysYmd("2026-01-01", -1)).toBe("2025-12-31");
    expect(diffDaysYmd("2026-01-01", "2026-01-31")).toBe(30);
  });
});

describe("parseVisitFilters", () => {
  it("defaults both dates to today in the site's time zone", () => {
    const f = parseVisitFilters({}, { timeZone: TZ, now: NOW });
    expect(f.from).toBe("2026-03-09");
    expect(f.to).toBe("2026-03-09");
    expect(f.page).toBe(1);
    expect(f.kind).toBeUndefined();
  });
  it("keeps valid values and drops invalid ones instead of throwing", () => {
    const f = parseVisitFilters(
      { from: "2026-03-01", to: "2026-03-05", kind: "vendor", status: "bogus", host: "  Ana ", areaId: "not valid!", company: "", page: "3", siteId: "ckxyz", gateId: ["g1", "g2"] },
      { timeZone: TZ, now: NOW },
    );
    expect(f).toMatchObject({ from: "2026-03-01", to: "2026-03-05", kind: "vendor", host: "Ana", page: 3, siteId: "ckxyz" });
    expect(f.status).toBeUndefined();
    expect(f.areaId).toBeUndefined();
    expect(f.company).toBeUndefined();
    expect(f.gateId).toBeUndefined();
  });
  it("swaps a reversed range, fills a missing end and caps the length", () => {
    expect(parseVisitFilters({ from: "2026-03-05", to: "2026-03-01" }, { timeZone: TZ })).toMatchObject({ from: "2026-03-01", to: "2026-03-05" });
    expect(parseVisitFilters({ from: "2026-03-05" }, { timeZone: TZ })).toMatchObject({ from: "2026-03-05", to: "2026-03-05" });
    expect(parseVisitFilters({ to: "2026-03-05" }, { timeZone: TZ })).toMatchObject({ from: "2026-03-05", to: "2026-03-05" });
    const capped = parseVisitFilters({ from: "2024-01-01", to: "2026-12-31" }, { timeZone: TZ });
    expect(diffDaysYmd(capped.from, capped.to)).toBe(MAX_RANGE_DAYS - 1);
  });
  it("treats bad pages as page 1", () => {
    expect(parseVisitFilters({ page: "0" }, { timeZone: TZ }).page).toBe(1);
    expect(parseVisitFilters({ page: "abc" }, { timeZone: TZ }).page).toBe(1);
    expect(parseVisitFilters({ page: "2.5" }, { timeZone: TZ }).page).toBe(1);
  });
  it("converts the inclusive local range to half-open UTC instants", () => {
    const r = rangeToUtc({ from: "2026-03-01", to: "2026-03-02" }, TZ);
    expect(r.from.toISOString()).toBe("2026-03-01T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-03T04:00:00.000Z");
  });
});

describe("parseShiftLogFilters", () => {
  it("accepts shift-log kinds and guard text only", () => {
    const f = parseShiftLogFilters({ kind: "incident", guard: "Pérez", status: "inside" } as Record<string, string>, { timeZone: TZ, now: NOW });
    expect(f.kind).toBe("incident");
    expect(f.guard).toBe("Pérez");
    expect("status" in f).toBe(false);
    expect(parseShiftLogFilters({ kind: "vendor" }, { timeZone: TZ }).kind).toBeUndefined();
  });
});

describe("filtersToQuery", () => {
  it("omits empty values and page 1, keeps the rest, applies overrides", () => {
    expect(filtersToQuery({ from: "2026-03-01", to: "2026-03-01", host: undefined, company: "", page: 1 })).toBe("?from=2026-03-01&to=2026-03-01");
    expect(filtersToQuery({ from: "2026-03-01", page: 2 }, { page: 3 })).toBe("?from=2026-03-01&page=3");
    expect(filtersToQuery({ host: "Ana María" })).toBe("?host=Ana+Mar%C3%ADa");
    expect(filtersToQuery({})).toBe("");
  });
});

const site = { id: "s1", name: "Airlink 2", timezone: TZ };
const gate = { id: "g1", name: "Recepción" };
function visit(over: Partial<VisitRow> = {}): VisitRow {
  return {
    id: "v1",
    siteId: site.id,
    gateId: gate.id,
    passId: null,
    hostEmployeeId: "e1",
    companyId: "c1",
    visitorName: "Juan Pérez",
    docLast4: "1234",
    docHash: null,
    plate: null,
    photoKey: null,
    extra: null,
    autoClosed: false,
    badgePhotoKey: null,
    kind: "vendor",
    status: "left",
    requestedById: "u1",
    decidedById: null,
    decidedAt: null,
    enteredAt: new Date("2026-03-10T13:05:00Z"),
    leftAt: new Date("2026-03-10T14:50:30Z"),
    badgeNo: "A-017",
    areaIds: [],
    escortEmployeeId: null,
    scanId: null,
    conflict: false,
    createdAt: new Date("2026-03-10T13:00:00Z"),
    updatedAt: new Date("2026-03-10T13:00:00Z"),
    site,
    gate,
    host: { id: "e1", name: "Ana; \"La Jefa\"", department: "IT" },
    company: { id: "c1", name: "Uptime, SRL" },
    escort: null,
    decidedBy: null,
    pass: null,
    ...over,
  };
}
const visitLabels = {
  date: "Fecha", visitor: "Visitante", docLast4: "Cédula", plate: "Placa", company: "Empresa", host: "Anfitrión", kind: "Tipo", site: "Sitio", gate: "Puerta",
  status: "Estado", enteredAt: "Entrada", leftAt: "Salida", durationMin: "Duración (min)", badgeNo: "Gafete", escort: "Acompañante",
  kinds: { vendor: "Proveedor" }, statuses: { left: "Salió", inside: "Dentro" },
};

describe("CSV building blocks", () => {
  it("quotes only when needed and doubles inner quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
  it("formats dates in the site's time zone, 24 h", () => {
    expect(csvDate(new Date("2026-03-10T03:05:00Z"), TZ)).toBe("2026-03-09 23:05");
    expect(csvDate(new Date("2026-03-10T04:00:00Z"), TZ)).toBe("2026-03-10 00:00");
    expect(csvDate(null, TZ)).toBe("");
  });
  it("computes whole-minute durations", () => {
    expect(durationMinutes(new Date("2026-03-10T13:05:00Z"), new Date("2026-03-10T14:50:30Z"))).toBe(106);
    expect(durationMinutes(new Date(), null)).toBeNull();
  });
});

describe("visitsToCsv", () => {
  it("writes BOM, semicolon separator, CRLF, local dates and translated enums", () => {
    const csv = visitsToCsv([visit()], TZ, visitLabels);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toHaveLength(3); // header, row, trailing newline
    expect(lines[0]).toBe("Fecha;Visitante;Cédula;Placa;Empresa;Anfitrión;Tipo;Sitio;Puerta;Estado;Entrada;Salida;Duración (min);Gafete;Acompañante");
    expect(lines[1]).toBe('2026-03-10 09:05;Juan Pérez;1234;;"Uptime, SRL";"Ana; ""La Jefa""";Proveedor;Airlink 2;Recepción;Salió;2026-03-10 09:05;2026-03-10 10:50;106;A-017;');
    expect(lines[2]).toBe("");
  });
  it("falls back to the registration date and blank duration for visits that never entered", () => {
    const csv = visitsToCsv([visit({ status: "inside", enteredAt: null, leftAt: null, badgeNo: null })], TZ, visitLabels);
    const row = csv.split("\r\n")[1]!;
    expect(row.startsWith("2026-03-10 09:00;Juan Pérez")).toBe(true);
    expect(row).toContain(";Dentro;;;;;");
  });
  it("produces only the header for no rows", () => {
    expect(visitsToCsv([], TZ, visitLabels).split("\r\n")).toHaveLength(2);
  });
  it("adds one column per custom answer present in the rows, labelled with the question", () => {
    const rows = [
      visit({ extra: { answers: { model: { label: "Modelo", value: "iPhone 15" }, ppe: { label: "Trae EPP", value: true } } } }),
      visit({ visitorName: "Sin respuestas", extra: null }),
      visit({ visitorName: "Otra", extra: { answers: { units: { label: "Unidades; cajas", value: 3 }, model: { label: "Modelo", value: "=SUM(1)" } } } }),
    ];
    const lines = visitsToCsv(rows, TZ, { ...visitLabels, yes: "Sí", no: "No" }).slice(1).split("\r\n");
    expect(lines[0]).toBe("Fecha;Visitante;Cédula;Placa;Empresa;Anfitrión;Tipo;Sitio;Puerta;Estado;Entrada;Salida;Duración (min);Gafete;Acompañante;Modelo;Trae EPP;\"Unidades; cajas\"");
    expect(lines[1]!.endsWith(";iPhone 15;Sí;")).toBe(true);
    expect(lines[2]!.endsWith(";;;")).toBe(true);
    expect(lines[3]!.endsWith(";'=SUM(1);;3")).toBe(true);
  });
});

describe("auditToCsv", () => {
  it("includes NDA, approvals, areas and blacklist hits", () => {
    const row: AuditRow = {
      ...visit({
        areaIds: ["a1", "a2"],
        escort: { id: "e2", name: "Luis" },
        decidedBy: { id: "u2", name: "Guardia Uno" },
        decidedAt: new Date("2026-03-10T13:04:00Z"),
        pass: { id: "p1", ndaVersion: "1.0", ndaAcceptedAt: new Date("2026-03-09T20:00:00Z"), approvedAt: new Date("2026-03-09T18:30:00Z"), approvedBy: { id: "u3", name: "Aprobador" } },
      }),
      areaNames: ["IQC", "Almacén"],
      blacklistHits: 2,
    };
    const labels = { ...visitLabels, areas: "Áreas", ndaVersion: "NDA", ndaAcceptedAt: "NDA el", passApprovedBy: "Pase por", passApprovedAt: "Pase el", visitDecidedBy: "Decidido por", visitDecidedAt: "Decidido el", blacklistHits: "Alertas" };
    const lines = auditToCsv([row], TZ, labels).slice(1).split("\r\n");
    expect(lines[0]).toBe("Fecha;Visitante;Cédula;Empresa;Anfitrión;Tipo;Sitio;Puerta;Estado;Entrada;Salida;Áreas;Acompañante;NDA;NDA el;Pase por;Pase el;Decidido por;Decidido el;Alertas");
    expect(lines[1]).toBe('2026-03-10 09:05;Juan Pérez;1234;"Uptime, SRL";"Ana; ""La Jefa""";Proveedor;Airlink 2;Recepción;Salió;2026-03-10 09:05;2026-03-10 10:50;"IQC, Almacén";Luis;1.0;2026-03-09 16:00;Aprobador;2026-03-09 14:30;Guardia Uno;2026-03-10 09:04;2');
  });
});

describe("shiftLogsToCsv", () => {
  it("writes one line per entry with the media link", () => {
    const row: ShiftLogRow = {
      id: "l1", siteId: site.id, gateId: gate.id, guardId: "u1", kind: "incident", text: "Puerta trasera abierta\nse cerró a las 3", photoKey: "s/s1/shiftlogs/l1.jpg", at: new Date("2026-03-10T07:00:00Z"),
      site, gate, guard: { id: "u1", name: "Guardia Uno" },
    };
    const lines = shiftLogsToCsv([row], TZ, { at: "Hora", site: "Sitio", gate: "Puerta", guard: "Guardia", kind: "Tipo", text: "Texto", photo: "Foto", kinds: { incident: "Incidente" } }).slice(1).split("\r\n");
    expect(lines[0]).toBe("Hora;Sitio;Puerta;Guardia;Tipo;Texto;Foto");
    expect(lines[1]).toBe('2026-03-10 03:00;Airlink 2;Recepción;Guardia Uno;Incidente;"Puerta trasera abierta\nse cerró a las 3";/api/media/s/s1/shiftlogs/l1.jpg');
  });
});

describe("csvCell formula injection", () => {
  it("prefixes cells Excel would evaluate as formulas", async () => {
    const { csvCell } = await import("@/lib/server/reports");
    expect(csvCell('=HYPERLINK("https://evil")')).toBe(`'=HYPERLINK(""https://evil"")`.replace(/^'=HYPERLINK\(""https:\/\/evil""\)$/, `"'=HYPERLINK(""https://evil"")"`));
    expect(csvCell("+1 809")).toBe("'+1 809");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@user")).toBe("'@user");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("Uptime SRL")).toBe("Uptime SRL");
  });
});
