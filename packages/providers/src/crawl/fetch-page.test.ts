import { describe, expect, it } from "vitest";
import { classifyFetchError, fetchPage } from "./fetch-page.js";
import { CRAWLER_USER_AGENT } from "./policy.js";
import { isFetchOk } from "./types.js";

function respond(init: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  url?: string;
}): typeof fetch {
  return (async () => {
    const status = init.status ?? 200;
    const headers = new Headers(init.headers ?? { "content-type": "text/html" });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: init.statusText ?? "",
      url: init.url ?? "https://example.com/",
      headers,
      text: async () => init.body ?? "<html><body>hi</body></html>",
    } as unknown as Response;
  }) as typeof fetch;
}

function throws(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as typeof fetch;
}

describe("fetchPage — success", () => {
  it("returns the html, final url and status", async () => {
    const result = await fetchPage({
      url: "https://example.com/",
      fetchImpl: respond({ body: "<html><head><title>Hi</title></head></html>" }),
    });
    expect(isFetchOk(result)).toBe(true);
    if (isFetchOk(result)) {
      expect(result.status).toBe(200);
      expect(result.html).toContain("<title>Hi</title>");
      expect(result.finalUrl).toBe("https://example.com/");
    }
  });

  it("identifies itself honestly and asks only for html — never disguised as a browser", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      captured = init;
      return {
        ok: true, status: 200, statusText: "", url: "https://example.com/",
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html></html>",
      } as unknown as Response;
    }) as typeof fetch;

    await fetchPage({ url: "https://example.com/", fetchImpl });

    const headers = captured?.headers as Record<string, string>;
    expect(captured?.method).toBe("GET"); // never POST — we read sites, never act on them
    expect(headers["User-Agent"]).toBe(CRAWLER_USER_AGENT);
    expect(headers["User-Agent"]).toContain("aheadtech360.com"); // a contact URL, per §13
    expect(headers["Cookie"]).toBeUndefined();
    expect(headers["Authorization"]).toBeUndefined();
  });
});

describe("fetchPage — every failure keeps its own identity", () => {
  it("http_error carries the status", async () => {
    const result = await fetchPage({
      url: "https://example.com/",
      fetchImpl: respond({ status: 503, statusText: "Service Unavailable" }),
    });
    expect(result.outcome).toBe("http_error");
    expect(isFetchOk(result)).toBe(false);
    if (!isFetchOk(result)) expect(result.status).toBe(503);
  });

  it("not_html for a served PDF", async () => {
    const result = await fetchPage({
      url: "https://example.com/",
      fetchImpl: respond({ headers: { "content-type": "application/pdf" } }),
    });
    expect(result.outcome).toBe("not_html");
  });

  it("too_large when content-length exceeds the cap, without reading the body", async () => {
    const result = await fetchPage({
      url: "https://example.com/",
      maxBytes: 100,
      fetchImpl: respond({ headers: { "content-type": "text/html", "content-length": "999999" } }),
    });
    expect(result.outcome).toBe("too_large");
  });

  it("too_large when the body exceeds the cap despite no content-length header", async () => {
    const result = await fetchPage({
      url: "https://example.com/",
      maxBytes: 10,
      fetchImpl: respond({ body: "x".repeat(500) }),
    });
    expect(result.outcome).toBe("too_large");
  });

  it("timeout on abort", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const result = await fetchPage({ url: "https://example.com/", fetchImpl: throws(abort) });
    expect(result.outcome).toBe("timeout");
  });

  it("rejects a non-http protocol rather than attempting it", async () => {
    const result = await fetchPage({ url: "ftp://example.com/", fetchImpl: respond({}) });
    expect(result.outcome).toBe("fetch_failed");
    if (!isFetchOk(result)) expect(result.detail).toContain("protocol");
  });

  it("rejects an unparseable url", async () => {
    const result = await fetchPage({ url: "not a url", fetchImpl: respond({}) });
    expect(result.outcome).toBe("fetch_failed");
  });

  /**
   * The rule §13 exists to protect: nothing that failed may ever be reported as a success. If
   * this ever regresses, a site we could not read would score as a site with no problems.
   */
  it("NO failure path ever yields outcome 'ok'", async () => {
    const failures = [
      await fetchPage({ url: "https://e.com/", fetchImpl: respond({ status: 404 }) }),
      await fetchPage({ url: "https://e.com/", fetchImpl: respond({ status: 500 }) }),
      await fetchPage({ url: "https://e.com/", fetchImpl: respond({ headers: { "content-type": "image/png" } }) }),
      await fetchPage({ url: "https://e.com/", maxBytes: 1, fetchImpl: respond({ body: "toolong" }) }),
      await fetchPage({ url: "https://e.com/", fetchImpl: throws(new Error("ECONNREFUSED")) }),
      await fetchPage({ url: "bad url", fetchImpl: respond({}) }),
    ];
    for (const f of failures) {
      expect(f.outcome).not.toBe("ok");
      expect(isFetchOk(f)).toBe(false);
      expect("html" in f).toBe(false);
    }
  });
});

describe("classifyFetchError", () => {
  it("reads the code from a nested cause, the way Node's fetch actually reports it", () => {
    const err = new Error("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
    expect(classifyFetchError(err)).toBe("dns_failure");
  });

  /**
   * The distinction that stops a flaky local network from producing "this business's website is
   * dead". ENOTFOUND is NXDOMAIN — the name really is not there. EAI_AGAIN is the resolver being
   * unreachable, which is a fact about us. Two real businesses were recorded dead on EAI_AGAIN
   * while answering HTTP 200 minutes later.
   */
  it("keeps a temporary resolver failure apart from a domain that does not exist", () => {
    const temporary = new Error("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo EAI_AGAIN example.com"), { code: "EAI_AGAIN" }),
    });
    expect(classifyFetchError(temporary)).toBe("dns_temporary");
    expect(classifyFetchError(temporary)).not.toBe("dns_failure");
  });

  it("distinguishes certificate problems from plain connection failures", () => {
    const tls = new Error("fetch failed", {
      cause: Object.assign(new Error("bad cert"), { code: "CERT_HAS_EXPIRED" }),
    });
    expect(classifyFetchError(tls)).toBe("tls_failure");
    expect(classifyFetchError(new Error("ECONNREFUSED"))).toBe("fetch_failed");
  });

  it("maps connect timeouts to timeout", () => {
    const err = new Error("fetch failed", {
      cause: Object.assign(new Error("t"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    });
    expect(classifyFetchError(err)).toBe("timeout");
  });

  it("falls back to fetch_failed rather than guessing", () => {
    expect(classifyFetchError(new Error("something odd"))).toBe("fetch_failed");
    expect(classifyFetchError(null)).toBe("fetch_failed");
  });
});

/**
 * The retry exists because of three real audit runs on the operator's machine, which returned
 * `dns_temporary` for 112, then 67, then 124 of a few hundred businesses. Every one was the home
 * resolver under concurrent lookups; none was a site. Until this, clearing them meant running the
 * audit again by hand at falling concurrency, and in between the app showed those businesses as
 * unreadable.
 */
describe("temporary DNS failures are retried once", () => {
  function failingThen(codes: string[]): { impl: typeof fetch; calls: () => number } {
    let call = 0;
    const impl = (async () => {
      const code = codes[call] ?? "ok";
      call += 1;
      if (code === "ok") {
        return new Response("<html><body>hi</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      throw new Error("fetch failed", { cause: Object.assign(new Error(code), { code }) });
    }) as unknown as typeof fetch;
    return { impl, calls: () => call };
  }

  it("succeeds on the second attempt when the resolver recovers", async () => {
    const { impl, calls } = failingThen(["EAI_AGAIN"]);
    const result = await fetchPage({ url: "https://example.com/", fetchImpl: impl });
    expect(result.outcome).toBe("ok");
    expect(calls()).toBe(2);
  });

  it("still reports dns_temporary when both attempts fail, never dns_failure", async () => {
    const { impl, calls } = failingThen(["EAI_AGAIN", "EAI_AGAIN"]);
    const result = await fetchPage({ url: "https://example.com/", fetchImpl: impl });
    expect(result.outcome).toBe("dns_temporary");
    expect(calls()).toBe(2);
  });

  /** A domain that does not exist is a real answer. Repeating the question is only slower. */
  it("does not retry a domain that genuinely does not resolve", async () => {
    const { impl, calls } = failingThen(["ENOTFOUND"]);
    const result = await fetchPage({ url: "https://example.com/", fetchImpl: impl });
    expect(result.outcome).toBe("dns_failure");
    expect(calls()).toBe(1);
  });

  it("does not retry an HTTP error, which is the server's considered reply", async () => {
    const { impl, calls } = failingThen([]);
    void impl;
    const forbidden = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    const result = await fetchPage({ url: "https://example.com/", fetchImpl: forbidden });
    expect(result.outcome).toBe("http_error");
    expect(calls()).toBe(0);
  });
});
