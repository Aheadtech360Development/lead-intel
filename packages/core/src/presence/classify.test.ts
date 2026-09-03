import { describe, expect, it } from "vitest";
import { classifyPresence, type PresenceEvidence } from "./classify.js";

function evidence(overrides: Partial<PresenceEvidence> = {}): PresenceEvidence {
  return {
    hasWebsiteOnListing: true,
    domain: "example.com",
    fetchOutcome: "ok",
    httpStatus: 200,
    finalUrl: "https://example.com/",
    html: "<html><body><h1>Unique Screen Printing</h1><p>Custom shirts in Miami since 1998. Call us for a quote.</p></body></html>",
    ...overrides,
  };
}

describe("classifyPresence — live", () => {
  it("calls a working site live", () => {
    const verdict = classifyPresence(evidence());
    expect(verdict.status).toBe("live");
    expect(verdict.needsManualReview).toBe(false);
  });
});

describe("classifyPresence — dead", () => {
  it("a domain that does not resolve is dead", () => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "dns_failure" }));
    expect(verdict.status).toBe("dead");
    expect(verdict.needsManualReview).toBe(false);
  });

  /**
   * The counterpart, and the reason `dns_temporary` exists at all. `EAI_AGAIN` is "temporary
   * failure in name resolution" — our resolver, not their domain. Found live: two businesses were
   * recorded dead on it while answering HTTP 200 minutes later.
   */
  it("a TEMPORARY name-resolution failure is not dead — that fault is ours, not theirs", () => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "dns_temporary" }));
    expect(verdict.status).toBe("unclear");
    expect(verdict.status).not.toBe("dead");
    expect(verdict.needsManualReview).toBe(true);
  });

  it("a 404 homepage is dead — nothing is there", () => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "http_error", httpStatus: 404 }));
    expect(verdict.status).toBe("dead");
  });

  it("a 410 Gone homepage is dead", () => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "http_error", httpStatus: 410 }));
    expect(verdict.status).toBe("dead");
  });

  it("a redirect to a domain-parking host is dead", () => {
    const verdict = classifyPresence(
      evidence({ finalUrl: "http://ww1.sedoparking.com/example.com", html: "<html><body>Buy this domain</body></html>" }),
    );
    expect(verdict.status).toBe("dead");
    expect(verdict.reason).toMatch(/parking/i);
  });

  it("a for-sale placeholder page is dead even on HTTP 200", () => {
    const verdict = classifyPresence(
      evidence({ html: "<html><body><h1>example.com</h1><p>This domain is for sale. Enquire now.</p></body></html>" }),
    );
    expect(verdict.status).toBe("dead");
  });

  it("an expired-domain holding page is dead", () => {
    const verdict = classifyPresence(
      evidence({ html: "<html><body>This domain has expired and is pending renewal or deletion.</body></html>" }),
    );
    expect(verdict.status).toBe("dead");
  });
});

describe("classifyPresence — never guesses 'no website'", () => {
  /**
   * The most valuable finding in the system is also the most expensive to get wrong — someone
   * picks up the phone and pitches a website to a business that already has one. §4 requires
   * three checks; only one exists, so this must not resolve.
   */
  it("a business with no listed website is unclear, NOT no_website", () => {
    const verdict = classifyPresence(evidence({ hasWebsiteOnListing: false, domain: null, fetchOutcome: "not_attempted" }));
    expect(verdict.status).toBe("unclear");
    expect(verdict.status).not.toBe("no_website");
    expect(verdict.needsManualReview).toBe(true);
    expect(verdict.reason).toMatch(/unconfirmed|Facebook|name search/i);
  });

  it("never returns no_website or social_only from any input", () => {
    const outcomes: PresenceEvidence["fetchOutcome"][] = [
      "ok", "blocked_by_robots", "dns_failure", "dns_temporary", "tls_failure", "timeout",
      "http_error", "too_many_redirects", "too_large", "not_html", "fetch_failed", "not_attempted",
    ];
    for (const fetchOutcome of outcomes) {
      for (const domain of ["example.com", null]) {
        for (const hasWebsiteOnListing of [true, false]) {
          const verdict = classifyPresence(evidence({ fetchOutcome, domain, hasWebsiteOnListing }));
          expect(verdict.status).not.toBe("no_website");
          expect(verdict.status).not.toBe("social_only");
        }
      }
    }
  });
});

describe("classifyPresence — unmeasured is never a pass", () => {
  it("robots.txt blocking us proves nothing either way", () => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "blocked_by_robots" }));
    expect(verdict.status).toBe("unclear");
    expect(verdict.needsManualReview).toBe(true);
  });

  it("a timeout is unclear, not dead — a slow server is not an absent one", () => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "timeout" }));
    expect(verdict.status).toBe("unclear");
  });

  it("a 5xx is unclear, not dead — it may be a momentary outage", () => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "http_error", httpStatus: 503 }));
    expect(verdict.status).toBe("unclear");
    expect(verdict.needsManualReview).toBe(true);
  });

  /**
   * Found by the first live audit, which called a working Miami print shop "dead" because its
   * bot protection answered 403 (its robots.txt was refused too — the tell). Being turned away
   * says something about us, not about the business, and pitching a rebuild to someone whose
   * site works fine is the most expensive mistake this function can make.
   */
  it.each([401, 403, 429])("HTTP %i means we were blocked, not that the site is dead", (httpStatus) => {
    const verdict = classifyPresence(evidence({ fetchOutcome: "http_error", httpStatus }));
    expect(verdict.status).toBe("unclear");
    expect(verdict.status).not.toBe("dead");
    expect(verdict.needsManualReview).toBe(true);
    expect(verdict.reason).toMatch(/refused|bot protection/i);
  });

  it("an unusual 4xx is unclear rather than guessed either way", () => {
    for (const httpStatus of [400, 405, 406, 451]) {
      expect(classifyPresence(evidence({ fetchOutcome: "http_error", httpStatus })).status).toBe("unclear");
    }
  });

  it("a page with no readable content is unclear rather than judged either way", () => {
    const verdict = classifyPresence(evidence({ html: "<html><body><div id='root'></div></body></html>" }));
    expect(verdict.status).toBe("unclear");
  });

  /** The §13 invariant, asserted directly: nothing unmeasured may come back looking healthy. */
  it("NO failed fetch outcome ever yields 'live'", () => {
    const failures: PresenceEvidence["fetchOutcome"][] = [
      "blocked_by_robots", "dns_failure", "dns_temporary", "tls_failure", "timeout",
      "http_error", "too_many_redirects", "too_large", "not_html", "fetch_failed", "not_attempted",
    ];
    for (const fetchOutcome of failures) {
      expect(classifyPresence(evidence({ fetchOutcome })).status).not.toBe("live");
    }
  });
});

describe("classifyPresence — does not over-fire on thin but real sites", () => {
  it("a small genuine site is live, not parked", () => {
    const verdict = classifyPresence(
      evidence({ html: "<html><body><h1>Bob's Barbershop</h1><p>Open Tuesday to Saturday. Walk-ins welcome. 305-555-0100</p></body></html>" }),
    );
    expect(verdict.status).toBe("live");
  });

  it("'coming soon' alone does not make a site dead — too many real sites say it", () => {
    const verdict = classifyPresence(
      evidence({ html: "<html><body><h1>Coming soon</h1><p>Our new online store launches in March. Call 305-555-0100 to order meanwhile.</p></body></html>" }),
    );
    expect(verdict.status).toBe("live");
  });
});
