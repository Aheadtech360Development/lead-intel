import { describe, expect, it } from "vitest";
import { nameSimilarity, normalizeName } from "./name.js";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Unique Screen Printing  ")).toBe("unique screen printing");
  });

  it("strips punctuation", () => {
    expect(normalizeName("Artee's Custom Screen-Printing!")).toBe("artees custom screen printing");
  });

  it("removes an apostrophe without splitting the word it's in", () => {
    expect(normalizeName("O'Brien's Plumbing")).toBe("obriens plumbing");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeName("Unique   Screen\tPrinting")).toBe("unique screen printing");
  });

  it("strips accents", () => {
    expect(normalizeName("Café Résumé")).toBe("cafe resume");
  });

  it("removes exactly one trailing legal-entity suffix", () => {
    expect(normalizeName("Bright Harbor Apparel LLC")).toBe("bright harbor apparel");
    expect(normalizeName("Bright Harbor Apparel, Inc.")).toBe("bright harbor apparel");
    expect(normalizeName("Northbound Denim Corp")).toBe("northbound denim");
  });

  it("keeps 'co' and 'company' — they are common suffixes but also genuinely part of some names", () => {
    expect(normalizeName("The Sign Company")).toBe("the sign company");
    expect(normalizeName("Fern & Field Co")).toBe("fern field co");
  });

  it("does not strip a suffix-like word that is the whole name", () => {
    expect(normalizeName("Co")).toBe("co");
  });

  it("does not strip a suffix word that appears mid-name", () => {
    expect(normalizeName("Corp Cleaning Services")).toBe("corp cleaning services");
  });

  it("returns null for empty, missing, or punctuation-only input", () => {
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName(undefined)).toBeNull();
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName("!!!")).toBeNull();
  });
});

describe("nameSimilarity", () => {
  it("is 1 for identical normalised names", () => {
    expect(nameSimilarity("unique screen printing", "unique screen printing")).toBe(1);
  });

  it("is 0 when either side is null", () => {
    expect(nameSimilarity(null, "unique screen printing")).toBe(0);
    expect(nameSimilarity("unique screen printing", null)).toBe(0);
  });

  it("is partial for overlapping but different names", () => {
    const s = nameSimilarity("unique screen printing", "unique custom printing");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("is 0 for names with no shared words", () => {
    expect(nameSimilarity("unique screen printing", "harbor knit company")).toBe(0);
  });

  it("is symmetric", () => {
    const a = nameSimilarity("unique screen printing", "unique custom printing");
    const b = nameSimilarity("unique custom printing", "unique screen printing");
    expect(a).toBe(b);
  });
});
