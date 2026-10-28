import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/csp";

describe("buildCsp", () => {
  it("includes the nonce and locks down frames and objects", () => {
    const csp = buildCsp("abc", { dev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(buildCsp("abc", { dev: true })).toContain("'unsafe-eval'");
  });
});

describe("buildCsp browser print", () => {
  it("adds the Zebra Browser Print origins to connect-src only behind the flag", () => {
    expect(buildCsp("abc", { dev: false })).not.toContain("localhost:9100");
    const csp = buildCsp("abc", { dev: false, browserPrint: true });
    expect(csp).toContain("connect-src 'self' http://localhost:9100 https://localhost:9101");
    expect(csp).not.toMatch(/script-src[^;]*localhost:9100/);
  });
});
