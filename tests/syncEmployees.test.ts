import { describe, expect, it } from "vitest";
import { parseEmployeeRows } from "@/lib/sync/employees";

describe("parseEmployeeRows", () => {
  it("maps Spanish SPN column names", () => {
    const { ok, rejected } = parseEmployeeRows([
      { codigo: 1042, nombre: "  Juan   Pérez ", departamento: "IQC", extension: "215", correo: "JPEREZ@airlinkdr.com", telefono: null, foto: null, activo: "S" },
    ]);
    expect(rejected).toEqual([]);
    expect(ok).toEqual([
      {
        externalId: "1042",
        entraId: null,
        email: "jperez@airlinkdr.com",
        name: "Juan Pérez",
        department: "IQC",
        extension: "215",
        phone: null,
        photo: null,
        active: true,
        site: null,
      },
    ]);
  });

  it("maps English, accented and spaced column names", () => {
    const { ok } = parseEmployeeRows([
      { ID: "A-7", Name: "Ana Gómez", Department: "Almacén", Ext: 118, Email: "ana@airlinkdr.com", "Teléfono": "809-555-0101", Photo: "", Active: 1, Sitio: "Airlink 2" },
      { "Código Empleado": "8", "Nombre Completo": "Luis Díaz", "Correo Electrónico": "luis@airlinkdr.com", Estado: "Inactivo", "Object Id": "abc-123" },
    ]);
    expect(ok[0]).toMatchObject({ externalId: "A-7", name: "Ana Gómez", department: "Almacén", extension: "118", phone: "809-555-0101", photo: null, active: true, site: "Airlink 2" });
    expect(ok[1]).toMatchObject({ externalId: "8", name: "Luis Díaz", email: "luis@airlinkdr.com", active: false, entraId: "abc-123" });
  });

  it("repairs swapped name/email and name/code columns", () => {
    const { ok } = parseEmployeeRows([
      { codigo: "55", nombre: "maria@airlinkdr.com", correo: "María López" },
      { codigo: "Pedro Martínez", nombre: "77", correo: null },
      { codigo: "56", nombre: "rosa@airlinkdr.com", correo: "" },
    ]);
    expect(ok[0]).toMatchObject({ externalId: "55", name: "María López", email: "maria@airlinkdr.com" });
    expect(ok[1]).toMatchObject({ externalId: "77", name: "Pedro Martínez", email: null });
    // Email in the name column and no real name anywhere: the row is rejected (missing_name), not guessed.
    expect(ok).toHaveLength(2);
  });

  it("treats NULL strings, blanks and empty photos as null and defaults active to true", () => {
    const { ok } = parseEmployeeRows([
      { codigo: "9", nombre: "Carlos Ruiz", departamento: "NULL", extension: "   ", correo: "n/a", foto: "0x", activo: null },
      { codigo: "10", nombre: "Elena Mota", foto: { type: "Buffer", data: [] }, activo: "0" },
      { codigo: "11", nombre: "Nuria Gil", foto: new Uint8Array([1, 2, 3]), activo: "true" },
    ]);
    expect(ok[0]).toMatchObject({ department: null, extension: null, email: null, photo: null, active: true });
    expect(ok[1]).toMatchObject({ photo: null, active: false });
    expect(ok[2]).toMatchObject({ photo: Buffer.from([1, 2, 3]).toString("base64"), active: true });
  });

  it("rejects rows without a name or without any identifier, with a reason", () => {
    const { ok, rejected } = parseEmployeeRows([
      null,
      "not a row",
      { codigo: "1", nombre: "" },
      { nombre: "Sin Código", correo: "not-an-email" },
      { nombre: "Solo Correo", correo: "solo@airlinkdr.com" },
    ]);
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ externalId: null, email: "solo@airlinkdr.com", name: "Solo Correo" });
    expect(rejected.map((r) => r.reason)).toEqual(["not_an_object", "not_an_object", "missing_name", "missing_identifier"]);
    expect(rejected[2]?.row).toEqual({ codigo: "1", nombre: "" });
  });

  it("returns empty results for an empty payload", () => {
    expect(parseEmployeeRows([])).toEqual({ ok: [], rejected: [] });
  });
});
