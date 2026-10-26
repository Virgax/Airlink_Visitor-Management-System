import { describe, expect, it } from "vitest";
import { docHash, docLast4, normalizeDoc, normalizePlate } from "@/lib/crypto/docHash";

describe("docHash", () => {
  const key = "k".repeat(40);
  it("normalizes formatting so the same cédula matches", () => {
    expect(normalizeDoc("001-1234567-8")).toBe("00112345678");
    expect(docHash("001-1234567-8", key)).toBe(docHash("00112345678", key));
    expect(docHash("001 1234567 8", key)).toBe(docHash("00112345678", key));
  });
  it("differs per key and per document", () => {
    expect(docHash("00112345678", key)).not.toBe(docHash("00112345678", "x".repeat(40)));
    expect(docHash("00112345678", key)).not.toBe(docHash("00112345679", key));
  });
  it("keeps only the last four digits for display", () => {
    expect(docLast4("001-1234567-8")).toBe("5678");
  });
  it("normalizes plates", () => {
    expect(normalizePlate("a 123-bcd")).toBe("A123BCD");
  });
});
