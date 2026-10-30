import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findGuide, HELP_GUIDES, helpShots } from "@/lib/help/guides";

type Msgs = { help: { guides: Record<string, { title: string; summary: string; steps: Record<string, { title: string; body: string }> }> } };
const es = JSON.parse(readFileSync("messages/es.json", "utf8")) as Msgs;
const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as Msgs;

describe("help guides", () => {
  it("have unique slugs and step keys", () => {
    const slugs = HELP_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const g of HELP_GUIDES) {
      const keys = g.steps.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const r of g.related ?? []) expect(findGuide(r), `${g.slug} relates to ${r}`).toBeDefined();
    }
  });

  it("have a title, summary and every step text in Spanish and English", () => {
    for (const g of HELP_GUIDES) {
      for (const [lang, m] of [["es", es], ["en", en]] as const) {
        const guide = m.help.guides[g.slug];
        expect(guide, `${lang} ${g.slug}`).toBeDefined();
        expect(guide!.title.length).toBeGreaterThan(3);
        expect(guide!.summary.length).toBeGreaterThan(10);
        for (const s of g.steps) {
          expect(guide!.steps[s.key]?.title, `${lang} ${g.slug}.${s.key}.title`).toBeTruthy();
          expect(guide!.steps[s.key]?.body, `${lang} ${g.slug}.${s.key}.body`).toBeTruthy();
        }
      }
    }
  });

  it("ship a screenshot for every step that references one", () => {
    const shots = helpShots();
    expect(shots.length).toBeGreaterThan(20);
    for (const { shot } of shots) expect(existsSync(join("public", "help", `${shot}.png`)), `public/help/${shot}.png`).toBe(true);
  });
});
