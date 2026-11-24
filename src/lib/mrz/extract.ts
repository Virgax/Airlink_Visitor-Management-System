/**
 * Pure MRZ extraction from noisy OCR text (ICAO 9303): finds the three 30-character lines of a TD1 card (the
 * Dominican cédula, most national ID cards) or the two 44-character lines of a TD3 passport, repairs the usual
 * OCR confusions where the format tells us a position must be a digit or a letter, and returns the parsed fields
 * with their check-digit results. Unit-tested in tests/mrz.test.ts.
 */
import { parse } from "mrz";

export type MrzDocType = "cedula" | "passport" | "id";
export type MrzIdentity = {
  docType: MrzDocType;
  /** The number a visitor would type: the cédula number for DOM cards (optional data), else the MRZ document number. */
  docNumber: string;
  surname: string;
  givenNames: string;
  /** Pretty full name: "Adonis Javier Diaz Paredes". */
  fullName: string;
  nationality: string | null;
  issuer: string | null;
  birthDate: string | null; // YYYY-MM-DD
  expiryDate: string | null; // YYYY-MM-DD
  sex: "M" | "F" | null;
  /** All check digits passed. */
  valid: boolean;
  /** Fields whose check digit failed (the visitor should double-check them). */
  invalidFields: string[];
  lines: string[];
};

const ALPHABET = /^[A-Z0-9<]+$/;
const DIGIT_FIX: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6", T: "7", A: "4" };
const LETTER_FIX: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A", "7": "T" };

const toDigits = (s: string) => s.replace(/[A-Z]/g, (c) => DIGIT_FIX[c] ?? c);
const toLetters = (s: string) => s.replace(/[0-9]/g, (c) => LETTER_FIX[c] ?? c);

/** Cleans OCR output into candidate MRZ rows: uppercase, no spaces, only the MRZ alphabet. */
export function mrzRows(text: string): string[] {
  return text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/[\s«»]/g, "").replace(/[^A-Z0-9<]/g, ""))
    .filter((l) => l.length >= 20 && ALPHABET.test(l));
}

const fit = (s: string, len: number) => (s.length >= len ? s.slice(0, len) : s.padEnd(len, "<"));

/** TD1 line 1: document code (I/A/C), issuer, document number, check digit, optional data. */
function td1Line1(row: string): string | null {
  const m = row.match(/(?:I|A|C)[A-Z0-9<][A-Z0-9]{3}[A-Z0-9<]{25}/);
  if (!m) return null;
  const s = m[0];
  return s.slice(0, 2) + toLetters(s.slice(2, 5)) + s.slice(5);
}
/** TD1 line 2: birth date + check, sex, expiry + check, nationality, optional data, final check. */
function td1Line2(row: string): string | null {
  const fixed = row.replace(/[A-Z0-9]{7}[MF<X][A-Z0-9]{7}/g, (m) => toDigits(m.slice(0, 7)) + m[7] + toDigits(m.slice(8)));
  const m = fixed.match(/\d{7}[MF<X]\d{7}[A-Z0-9<]{3}[A-Z0-9<]{11}\d/) ?? fixed.match(/\d{7}[MF<X]\d{7}[A-Z0-9<]{3}[A-Z0-9<]{0,12}/);
  if (!m) return null;
  const s = fit(m[0], 30);
  return s.slice(0, 15) + toLetters(s.slice(15, 18)) + s.slice(18);
}
/** TD1 line 3 / names: the longest run of letters and fillers containing "<<". */
function namesLine(row: string, len: number): string | null {
  const runs = row.match(/[A-Z<]{10,}/g) ?? [];
  const best = runs.filter((r) => r.includes("<<")).sort((a, b) => b.length - a.length)[0];
  return best ? fit(best, len) : null;
}
/** TD3 line 1: P<ISSUER + names. */
function td3Line1(row: string): string | null {
  const m = row.match(/P[A-Z<][A-Z0-9]{3}[A-Z<]{39}/);
  return m ? m[0].slice(0, 2) + toLetters(m[0].slice(2, 5)) + m[0].slice(5) : null;
}
/** TD3 line 2: number(9) + check, nationality, birth + check, sex, expiry + check, personal number(14) + check, final check. */
function td3Line2(row: string): string | null {
  const m = row.match(/[A-Z0-9<]{9}\d[A-Z<]{3}\d{7}[MF<X]\d{7}[A-Z0-9<]{14}\d\d/);
  if (m) return m[0];
  const fixed = row.replace(/[A-Z0-9<]{9}[A-Z0-9][A-Z0-9]{3}[A-Z0-9]{7}[MF<X][A-Z0-9]{7}/g, (s) => s.slice(0, 9) + toDigits(s[9]!) + toLetters(s.slice(10, 13)) + toDigits(s.slice(13, 20)) + s[20] + toDigits(s.slice(21, 28)));
  const m2 = fixed.match(/[A-Z0-9<]{9}\d[A-Z<]{3}\d{7}[MF<X]\d{7}[A-Z0-9<]{0,16}/);
  return m2 ? fit(m2[0], 44) : null;
}

/** How many check digits of a parse hold: the score used to pick between candidate line sets. */
function score(lines: string[]): number {
  try {
    const r = parse(lines, { autocorrect: true });
    const ok = r.details.filter((d) => d.valid && d.field).length;
    const names = (r.fields.lastName ?? "").length + (r.fields.firstName ?? "").length > 3 ? 1 : 0;
    return ok + names + (r.fields.issuingState === "DOM" && /\d{11}/.test(toDigits(lines[0]!.slice(15).replace(/</g, " "))) ? 2 : 0);
  } catch {
    return -1;
  }
}

/** Finds the MRZ lines in cleaned rows: every TD1 (3 × 30) and TD3 (2 × 44) combination in reading order, best score wins. */
export function findMrzLines(rows: string[]): string[] | null {
  let best: { lines: string[]; score: number } | null = null;
  const consider = (lines: string[]) => {
    const sc = score(lines);
    if (sc >= 0 && (!best || sc > best.score)) best = { lines, score: sc };
  };
  for (let i = 0; i < rows.length; i++) {
    const l1 = td1Line1(rows[i]!);
    if (!l1) continue;
    for (let j = i + 1; j < Math.min(rows.length, i + 3); j++) {
      const l2 = td1Line2(rows[j]!);
      if (!l2) continue;
      for (let k = j + 1; k < Math.min(rows.length, j + 3); k++) {
        const l3 = namesLine(rows[k]!, 30);
        if (l3) consider([l1, l2, l3]);
      }
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const l1 = td3Line1(rows[i]!);
    if (!l1) continue;
    for (let j = i + 1; j < Math.min(rows.length, i + 3); j++) {
      const l2 = td3Line2(rows[j]!);
      if (l2) consider([l1, l2]);
    }
  }
  return best ? (best as { lines: string[] }).lines : null;
}

const isoDate = (yymmdd: string | null, kind: "birth" | "expiry"): string | null => {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const now = new Date().getUTCFullYear() % 100;
  // Births are in the past; expiries are read in this century (an expired card still expires after 2000).
  const century = kind === "birth" && yy > now ? 1900 : 2000;
  return `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
};

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase());
const formatCedula = (n: string) => `${n.slice(0, 3)}-${n.slice(3, 10)}-${n.slice(10)}`;

/** Parses MRZ lines (already located) into an identity; null when the parser rejects them outright. */
export function parseMrzLines(lines: string[]): MrzIdentity | null {
  let result: ReturnType<typeof parse>;
  try {
    result = parse(lines, { autocorrect: true });
  } catch {
    return null;
  }
  const f = result.fields;
  const surname = (f.lastName ?? "").trim();
  const givenNames = (f.firstName ?? "").trim();
  if (!surname && !givenNames) return null;
  const issuer = f.issuingState ?? null;
  const td1 = lines.length === 3;
  const optional = td1 ? lines[0]!.slice(15, 30) : "";
  const cedula = issuer === "DOM" ? (toDigits(optional.replace(/</g, " ")).match(/\d{11}/)?.[0] ?? null) : null;
  const docNumber = cedula ? formatCedula(cedula) : (f.documentNumber ?? "").replace(/</g, "").trim();
  if (!docNumber) return null;
  const invalid = result.details.filter((d) => !d.valid && d.field).map((d) => d.field as string);
  const sex = f.sex === "male" ? "M" : f.sex === "female" ? "F" : null;
  return {
    docType: cedula ? "cedula" : lines.length === 2 ? "passport" : "id",
    docNumber,
    surname: titleCase(surname),
    givenNames: titleCase(givenNames),
    fullName: titleCase(`${givenNames} ${surname}`.trim()),
    nationality: f.nationality ?? null,
    issuer,
    birthDate: isoDate(f.birthDate ?? null, "birth"),
    expiryDate: isoDate(f.expirationDate ?? null, "expiry"),
    sex,
    valid: result.valid,
    invalidFields: invalid,
    lines,
  };
}

/** OCR text → identity, or null when no MRZ is found. */
export function extractMrz(text: string): MrzIdentity | null {
  const lines = findMrzLines(mrzRows(text));
  return lines ? parseMrzLines(lines) : null;
}

/** Check-digit score of already located lines (-1 when unparseable). */
export const scoreMrzLines = score;

/**
 * Several OCR passes of the same document (different pre-processing): the best-scoring line set wins, and when
 * several passes tie, each line is settled by majority vote, which drops the stray character one pass hallucinated at
 * the edge of a line.
 */
export function extractMrzFromTexts(texts: string[]): MrzIdentity | null {
  const found = texts.map((t) => findMrzLines(mrzRows(t))).filter((l): l is string[] => Boolean(l));
  if (!found.length) return null;
  const scored = found.map((lines) => ({ lines, score: score(lines) }));
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top && s.lines.length === scored.find((x) => x.score === top)!.lines.length);
  if (best.length > 1) {
    const voted = best[0]!.lines.map((_, i) => {
      const counts = new Map<string, number>();
      for (const b of best) counts.set(b.lines[i]!, (counts.get(b.lines[i]!) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    });
    if (score(voted) >= top) return parseMrzLines(voted);
  }
  return parseMrzLines(best[0]!.lines);
}
