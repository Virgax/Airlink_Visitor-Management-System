import { describe, expect, it } from "vitest";
import { parse } from "mrz";
import { extractMrz, extractMrzFromTexts, findMrzLines, mrzRows, parseMrzLines } from "../src/lib/mrz/extract";

/** ICAO 9303 check digit (weights 7, 3, 1; letters A=10..Z=35; '<' = 0). */
function cd(s: string): string {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const v = c === "<" ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
    sum += v * w[i % 3]!;
  }
  return String(sum % 10);
}

/** A synthetic Dominican cédula (TD1): card serial in the document number, cédula number in the optional data. */
function cedula({ serial = "AB12345678", cedula = "00112345678", birth = "900101", expiry = "350101", sex = "F", names = "PEREZ<GOMEZ<<MARIA<JOSE" } = {}): string[] {
  // The 10-character serial overflows the 9-character field: filler at 15, the rest + its check digit in the optional data.
  const l1 = `IDDOM${serial.slice(0, 9)}<${serial.slice(9)}${cd(serial)}<${cedula}<`;
  const opt2 = "S".padEnd(11, "<");
  const l2head = `${birth}${cd(birth)}${sex}${expiry}${cd(expiry)}DOM${opt2}`;
  const l2 = l2head + cd(l1.slice(5, 30) + l2head.slice(0, 7) + l2head.slice(8, 15) + l2head.slice(18, 29));
  const l3 = names.padEnd(30, "<");
  expect([l1.length, l2.length, l3.length]).toEqual([30, 30, 30]);
  return [l1, l2, l3];
}

function passport(): string[] {
  const l1 = "P<DOMPEREZ<GOMEZ<<MARIA<JOSE".padEnd(44, "<");
  const num = "RD1234567", birth = "900101", expiry = "350101", personal = "".padEnd(14, "<");
  const body = `${num}${cd(num)}DOM${birth}${cd(birth)}F${expiry}${cd(expiry)}${personal}${cd(personal)}`;
  const l2 = body + cd(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
  expect(l2.length).toBe(44);
  return [l1, l2];
}

describe("MRZ: synthetic documents parse with every check digit valid", () => {
  it("Dominican cédula: the number the visitor would type comes from the optional data", () => {
    const lines = cedula();
    expect(parse(lines).valid).toBe(true);
    const id = parseMrzLines(lines)!;
    expect(id).toMatchObject({ docType: "cedula", docNumber: "001-1234567-8", surname: "Perez Gomez", givenNames: "Maria Jose", fullName: "Maria Jose Perez Gomez", nationality: "DOM", sex: "F", birthDate: "1990-01-01", expiryDate: "2035-01-01", valid: true, invalidFields: [] });
  });
  it("passport (TD3)", () => {
    const id = parseMrzLines(passport())!;
    expect(id).toMatchObject({ docType: "passport", docNumber: "RD1234567", fullName: "Maria Jose Perez Gomez", nationality: "DOM", valid: true });
  });
  it("a birth year after today's two digits is last century; expiries are this century", () => {
    const id = parseMrzLines(cedula({ birth: "050315", expiry: "300315" }))!;
    expect(id.birthDate).toBe("2005-03-15");
    expect(id.expiryDate).toBe("2030-03-15");
  });
});

describe("MRZ: locating the lines in noisy OCR output", () => {
  const [l1, l2, l3] = cedula();
  it("strips the stray characters OCR adds at the edges of the lines", () => {
    const text = `FORNARSAEUMNDINTODOMINGOESTE0\n9${l1}70\nB0${l2}\n0${l3}\n`;
    const id = extractMrz(text)!;
    expect(id.lines).toEqual([l1, l2, l3]);
    expect(id.valid).toBe(true);
  });
  it("repairs digits read as letters where the format demands a digit", () => {
    const broken = l2!.replace(/^9001/, "9OO1"); // zeros read as the letter O
    const id = extractMrz(`${l1}\n${broken}\n${l3}`)!;
    expect(id.birthDate).toBe("1990-01-01");
    expect(id.valid).toBe(true);
  });
  it("prefers the line set whose check digits hold over a look-alike line from the card's print", () => {
    const text = `ANANDRESJAQUEZLIRANZOSANTODOMI\n${l1}\n${l2}\n${l3}`;
    expect(findMrzLines(mrzRows(text))).toEqual([l1, l2, l3]);
  });
  it("ignores text without an MRZ", () => {
    expect(extractMrz("REPUBLICA DOMINICANA\nJUNTA CENTRAL ELECTORAL\n402-2254519-2\n")).toBeNull();
    expect(extractMrz("")).toBeNull();
  });
  it("finds a passport", () => {
    const [p1, p2] = passport();
    expect(extractMrz(`REPUBLICA\n${p1}\nX${p2}`)!.docType).toBe("passport");
  });
});

describe("MRZ: several OCR passes vote on each line", () => {
  const [l1, l2, l3] = cedula();
  it("the character one pass hallucinated in the names line loses the vote", () => {
    const a = `${l1}\n${l2}\nQ${l3!.slice(0, 29)}`; // a stray Q shifts the names: still "valid" (names have no check digit)
    const b = `${l1}\n${l2}\n${l3}`;
    const c = `${l1}\n${l2}\n${l3}`;
    expect(extractMrzFromTexts([a])!.surname).toBe("Qperez Gomez");
    expect(extractMrzFromTexts([a, b, c])!.surname).toBe("Perez Gomez");
  });
  it("a pass that read nothing does not spoil the others", () => {
    expect(extractMrzFromTexts(["garbage", `${l1}\n${l2}\n${l3}`])!.valid).toBe(true);
    expect(extractMrzFromTexts(["garbage"])).toBeNull();
  });
});
