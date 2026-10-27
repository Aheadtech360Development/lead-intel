import { describe, expect, it } from "vitest";
import { runInstagramChecks, runMetaAdsChecks } from "./paid-social.js";

const by = (results: ReturnType<typeof runMetaAdsChecks>, id: string) => {
  const found = results.find((r) => r.checkId === id);
  if (!found) throw new Error(`${id} missing — the purchase produced no finding for it`);
  return found;
};

describe("runMetaAdsChecks", () => {
  it("turns a live-ads answer into intent, and takes the problem away", () => {
    const results = runMetaAdsChecks({ pageFound: true, runningAds: true, activeCount: 4, runningSince: "2026-02-01" });

    expect(by(results, "N2").outcome).toBe("fired");
    expect(by(results, "N2").points).toBe(25);
    expect(by(results, "D5").outcome).toBe("passed");
    expect(by(results, "N2").evidence).toContain("4 live ads");
  });

  it("turns no live ads into a problem worth selling into", () => {
    const results = runMetaAdsChecks({ pageFound: true, runningAds: false });

    expect(by(results, "D5").outcome).toBe("fired");
    expect(by(results, "D5").points).toBe(15);
    expect(by(results, "N2").outcome).toBe("passed");
    expect(by(results, "N2").points).toBe(0);
  });

  /**
   * The distinction the whole product is built on. "They are not advertising" is a judgement;
   * "there is no page to look at" is not, and must never be scored as one.
   */
  it("refuses rather than guesses when there is no page to read", () => {
    for (const results of [
      runMetaAdsChecks(null),
      runMetaAdsChecks({ pageFound: false, runningAds: null }),
      runMetaAdsChecks({ pageFound: true, runningAds: null, unavailableReason: "Apify timed out." }),
    ]) {
      expect(by(results, "D5").outcome).toBe("not_measured");
      expect(by(results, "N2").outcome).toBe("not_measured");
      // Neither side of §6.1's sum: an unanswered check cannot count for or against anybody.
      expect(by(results, "D5").maxPoints).toBe(0);
      expect(by(results, "N2").maxPoints).toBe(0);
      expect(by(results, "D5").evidence.length).toBeGreaterThan(20);
    }
  });
});

describe("runInstagramChecks", () => {
  it("says in words why a bought profile still cannot answer these two", () => {
    const results = runInstagramChecks({ profileFound: true, followers: 4200, posts: 310, lastPostAt: null });

    expect(by(results, "O5").outcome).toBe("not_measured");
    expect(by(results, "N5").outcome).toBe("not_measured");
    expect(by(results, "O5").evidence).toContain("no post dates");
  });

  it("scores recency when a source for it ever arrives", () => {
    const now = new Date("2026-10-13T00:00:00Z");

    const quiet = runInstagramChecks({ profileFound: true, lastPostAt: new Date("2026-05-01T00:00:00Z") }, now);
    expect(by(quiet, "O5").outcome).toBe("fired");
    expect(by(quiet, "N5").outcome).toBe("passed");

    const busy = runInstagramChecks({ profileFound: true, lastPostAt: new Date("2026-10-05T00:00:00Z") }, now);
    expect(by(busy, "O5").outcome).toBe("passed");
    expect(by(busy, "N5").outcome).toBe("fired");
    expect(by(busy, "N5").points).toBe(15);
  });
});
