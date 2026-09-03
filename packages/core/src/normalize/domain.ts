import { parse } from "tldts";

/**
 * Normalises a raw URL or domain string into a comparable domain key.
 *
 * This is string normalisation only — no network call. Redirect resolution ("does this domain
 * actually point at a live site, and where does it land") is a fetch, so it belongs to the
 * crawler in packages/providers, not here. That function should call this one on whatever URL
 * it lands on after following redirects.
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Reject anything containing "@" outright, before URL parsing gets near it. Left unguarded,
  // `new URL("https://name@gmail.com")` parses "name" as URL userinfo and returns "gmail.com" as
  // the hostname — silently turning a pasted email address into a domain that has nothing to do
  // with the business, and one that collides with every other business whose email is also on
  // gmail.com. No legitimate business website input contains "@"; treating it as invalid here is
  // the same "return null rather than a wrong guess" rule as everywhere else in this file.
  if (trimmed.includes("@")) return null;

  // Add a scheme if missing so URL parsing works for bare domains like "example.com".
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let hostname: string;
  try {
    hostname = new URL(withScheme).hostname;
  } catch {
    return null;
  }

  const parsed = parse(hostname);
  if (!parsed.domain) return null;

  // parsed.domain already strips a leading "www." because tldts treats it as a subdomain of the
  // registrable domain — but keep other subdomains (shop.example.com stays distinct from
  // example.com, since a business's shop is not the same identity key as its blog).
  const host = parsed.subdomain && parsed.subdomain !== "www" ? hostname : parsed.domain;

  return host.toLowerCase().replace(/\.$/, "");
}

/** True if two raw inputs normalise to the same domain. Convenience for identity-key comparison. */
export function sameDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeDomain(a);
  const nb = normalizeDomain(b);
  return na !== null && na === nb;
}
