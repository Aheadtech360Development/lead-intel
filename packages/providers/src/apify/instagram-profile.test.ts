import { describe, expect, it } from "vitest";
import { fetchInstagramProfile, instagramHandle } from "./instagram-profile.js";

/**
 * The handles come off other people's websites, so they arrive in every shape a human ever pasted
 * into a footer. Getting one wrong does not fail loudly — it looks up a real account belonging to
 * somebody else and files their follower count against this business.
 */
describe("instagramHandle", () => {
  it("reads the ordinary forms", () => {
    // All five are verbatim from the operator's own data.
    expect(instagramHandle("https://www.instagram.com/contagiousgraphics/")).toBe("contagiousgraphics");
    expect(instagramHandle("https://www.instagram.com/the_printing_needle/")).toBe("the_printing_needle");
    expect(instagramHandle("http://instagram.com/happyendingstshirts")).toBe("happyendingstshirts");
    expect(instagramHandle("https://www.instagram.com/crookedmonkey")).toBe("crookedmonkey");
    expect(instagramHandle("instagram.com/methodprinting/")).toBe("methodprinting");
  });

  it("strips query strings, which footers pick up from share links", () => {
    expect(instagramHandle("https://www.instagram.com/acme/?hl=en&igshid=abc123")).toBe("acme");
  });

  it("accepts a bare handle with or without the @", () => {
    expect(instagramHandle("@acmeprinting")).toBe("acmeprinting");
    expect(instagramHandle("acmeprinting")).toBe("acmeprinting");
  });

  /**
   * The failure that would be silent. `/p/` and `/reel/` are posts, not profiles — a footer
   * linking a specific reel would otherwise yield the handle "p", which is a real Instagram
   * account belonging to somebody else entirely.
   */
  it("refuses Instagram's own routes rather than treating them as handles", () => {
    for (const url of [
      "https://www.instagram.com/p/CxYz123/",
      "https://www.instagram.com/reel/CxYz123/",
      "https://www.instagram.com/explore/tags/screenprinting/",
      "https://www.instagram.com/stories/acme/123/",
      "https://www.instagram.com/accounts/login/",
    ]) {
      expect(instagramHandle(url), url).toBeNull();
    }
  });

  it("returns null rather than guessing on nothing usable", () => {
    expect(instagramHandle(null)).toBeNull();
    expect(instagramHandle("")).toBeNull();
    expect(instagramHandle("https://www.instagram.com/")).toBeNull();
    expect(instagramHandle("not a url at all")).toBeNull();
  });
});

function respondWith(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("fetchInstagramProfile", () => {
  it("returns the fields the category rules and the score need", async () => {
    const result = await fetchInstagramProfile({
      url: "https://www.instagram.com/crystaldtfofficial/",
      token: "t",
      fetchImpl: respondWith(200, [
        {
          username: "crystaldtfofficial",
          fullName: "Crystal DTF",
          followersCount: 12400,
          followsCount: 310,
          postsCount: 890,
          biography: "DTF transfers shipped next day 👕",
          externalUrl: "https://crystaldtf.com",
          businessCategoryName: "Clothing (Brand)",
          isBusinessAccount: true,
          verified: false,
          private: false,
        },
      ]),
    });

    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.followersCount).toBe(12400);
    expect(result.categoryName).toBe("Clothing (Brand)");
    expect(result.biography).toContain("DTF");
  });

  /** A private account is a real state. Its follower count is null, never 0. */
  it("does not turn a withheld follower count into zero", async () => {
    const result = await fetchInstagramProfile({
      url: "@lockedshop",
      token: "t",
      fetchImpl: respondWith(200, [{ username: "lockedshop", private: true }]),
    });
    expect(result.outcome).toBe("ok");
    if (result.outcome !== "ok") return;
    expect(result.followersCount).toBeNull();
    expect(result.isPrivate).toBe(true);
  });

  it("reports an empty result as not_found, not as a failure", async () => {
    const result = await fetchInstagramProfile({ url: "@gone", token: "t", fetchImpl: respondWith(200, []) });
    expect(result.outcome).toBe("not_found");
  });

  /** Out of credit means stop the pass, not skip this business — see isApifyFatal. */
  it("separates running out of credit from an ordinary failure", async () => {
    const result = await fetchInstagramProfile({
      url: "@acme",
      token: "t",
      fetchImpl: respondWith(402, { error: { type: "usage-limit-exceeded", message: "Monthly usage exceeded" } }),
    });
    expect(result.outcome).toBe("out_of_credit");
  });

  it("never calls the actor for an address that is not a profile", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await fetchInstagramProfile({ url: "https://www.instagram.com/p/Cabc/", token: "t", fetchImpl: spy });
    expect(result.outcome).toBe("not_found");
    expect(called).toBe(false);
  });
});

/**
 * Platform accounts, found by buying five real profiles and reading them.
 *
 * One of the five — a braiding salon whose site is a Booksy booking page — came back as Booksy's
 * own account with 142,191 followers and the category "Software". The number was real; it just
 * belonged to somebody else.
 */
describe("instagramHandle and platform accounts", () => {
  it("refuses a booking platform's own account", () => {
    expect(instagramHandle("https://www.instagram.com/booksybiz/")).toBeNull();
    expect(instagramHandle("https://instagram.com/vagaro")).toBeNull();
  });

  it("refuses a website builder's own account, linked from a 'made with' footer", () => {
    expect(instagramHandle("https://www.instagram.com/squarespace/")).toBeNull();
    expect(instagramHandle("https://instagram.com/wix")).toBeNull();
  });

  it("still accepts a real business whose handle merely contains a platform name", () => {
    expect(instagramHandle("https://instagram.com/wixstudiodallas")).toBe("wixstudiodallas");
    expect(instagramHandle("https://instagram.com/squareonetees")).toBe("squareonetees");
  });

  /** Both seen in the operator's real data; both must survive. */
  it("strips Instagram's share parameters", () => {
    expect(instagramHandle("https://www.instagram.com/cozy_braid?igsh=MTVvcXA5ODk2NXAzcA==")).toBe("cozy_braid");
    expect(instagramHandle("https://www.instagram.com/_sharilove_?igsh=OG5m&utm_source=qr")).toBe("_sharilove_");
  });

  it("handles an all-uppercase URL", () => {
    expect(instagramHandle("HTTP://INSTAGRAM.COM/OLLIE.COMPANY.DTF")).toBe("ollie.company.dtf");
  });
});
