import { CRAWLER_USER_AGENT, PROBE_TIMEOUT_MS } from "./policy.js";

/**
 * `true`  — the resource exists and is genuinely the kind of thing we asked for
 * `false` — it definitively does not exist
 * `null`  — we could not tell (network failure, refused, ambiguous answer). Never guessed either
 *           way, because a check built on this must report *not measured* rather than invent an
 *           answer (spec §13).
 */
export type ProbeVerdict = boolean | null;

export interface ProbeResult {
  found: ProbeVerdict;
  status: number | null;
  contentType: string | null;
  detail: string | null;
}

interface ProbeParams {
  url: string;
  /** What the response must actually be for `found` to be true. */
  expect: "xml" | "image";
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Asks whether one small non-HTML resource — a sitemap, a favicon — really exists.
 *
 * The reason this is not simply "did it return 200": a large share of sites answer *every*
 * unknown path with their homepage at HTTP 200, including `/sitemap.xml` and `/favicon.ico`. A
 * naive existence check would therefore report a sitemap on sites that have none, and the S12
 * finding would silently be wrong on exactly the sites it matters for. So the content type (and
 * for XML, the first bytes of the body) has to agree before this says yes.
 *
 * GET, like every other request this crawler makes — §13 permits nothing else, and HEAD is
 * unreliably implemented on the small hosts this system spends most of its time on.
 */
export async function probeUrl(params: ProbeParams): Promise<ProbeResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? PROBE_TIMEOUT_MS);

  const miss = (extra: Partial<ProbeResult>): ProbeResult => ({
    found: null,
    status: null,
    contentType: null,
    detail: null,
    ...extra,
  });

  try {
    const response = await fetchImpl(params.url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type");

    // A clean 404/410 is a real answer: the resource is definitively absent.
    if (response.status === 404 || response.status === 410) {
      return { found: false, status: response.status, contentType, detail: null };
    }
    if (!response.ok) {
      return miss({ status: response.status, contentType, detail: "refused" });
    }

    if (params.expect === "image") {
      // Serving HTML at /favicon.ico is the catch-all case above — it means "no favicon here",
      // not "here is your icon".
      if (contentType && /^image\/|^text\/html|^application\/xhtml/i.test(contentType)) {
        const isImage = /^image\//i.test(contentType);
        return { found: isImage, status: response.status, contentType, detail: null };
      }
      // Some servers send favicons with no content type at all. A non-empty body that does not
      // start with markup is taken as the icon.
      const body = await response.text();
      const looksLikeMarkup = /^\s*(<!doctype|<html|<)/i.test(body);
      return {
        found: body.length > 0 && !looksLikeMarkup,
        status: response.status,
        contentType,
        detail: null,
      };
    }

    if (contentType && /^text\/html|^application\/xhtml/i.test(contentType)) {
      // The catch-all homepage again — this is not a sitemap.
      return { found: false, status: response.status, contentType, detail: "served HTML" };
    }

    const body = await response.text();
    const isXml = /^\s*(<\?xml|<urlset|<sitemapindex)/i.test(body);
    return { found: isXml, status: response.status, contentType, detail: isXml ? null : "not XML" };
  } catch (err) {
    return miss({ detail: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
}
