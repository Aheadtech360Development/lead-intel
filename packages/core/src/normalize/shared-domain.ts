import { parse } from "tldts";

/**
 * Domains that belong to a platform or a national chain rather than to the local business whose
 * listing carried them.
 *
 * Google Places returns whatever website a listing declares, and for a great many small
 * businesses that is a booking-platform profile (`booksy.com`, `vagaro.com`, a `.square.site`
 * subdomain) or a chain's store-locator page (`local.targetoptical.com`, `walmart.com`). Both
 * look exactly like a website to a crawler, so every check runs happily and produces findings —
 * about Booksy, or about Walmart, filed under a barber in Mesquite.
 *
 * That was not theoretical. In the first scored run, six such records passed the Stage 5 gate and
 * one of only two Tier 1 leads in the entire dataset was `local.targetoptical.com`. The top of a
 * ranked lead list is the least affordable place to be confidently wrong.
 *
 * **This function flags; it does not delete.** The identity keys stay where they are, because
 * removing them changes deduplication — `identity_keys` is unique per domain, so only one
 * business can ever hold `booksy.com`, which means these entries are already distorting merges
 * and unpicking that is a data decision for a human, not a side effect of scoring.
 */

/** Booking, scheduling and site-builder platforms whose subdomains are per-business profiles. */
const PLATFORM_DOMAINS = new Set([
  "booksy.com",
  "vagaro.com",
  "styleseat.com",
  "square.site",
  "squareup.com",
  "as.me",
  "acuityscheduling.com",
  "setmore.com",
  "schedulicity.com",
  "mindbodyonline.com",
  "glossgenius.com",
  "fresha.com",
  "simplybook.me",
  "zenoti.com",
  "janeapp.com",
  "mytime.com",
  "company.site",
  "business.site",
  "sites.google.com",
  "godaddysites.com",
  "wixsite.com",
  "weebly.com",
  "myshopify.com",
  "bigcartel.com",
  "etsy.com",
  "ecwid.com",
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "facebook.com",
  "instagram.com",
  "yelp.com",
  "opentable.com",
  "resy.com",
  "doordash.com",
  "ubereats.com",
  "grubhub.com",
  "toasttab.com",
  "clover.com",
]);

/**
 * National chains seen in this dataset. Deliberately a list of names rather than a rule: there is
 * no general way to tell a chain's domain from an independent's, and guessing would silence real
 * local businesses. It grows when a chain shows up, and that is the honest cost of it.
 */
const CHAIN_DOMAINS = new Set([
  "costco.com",
  "walmart.com",
  "samsclub.com",
  "target.com",
  "targetoptical.com",
  "jcpenney.com",
  "jcpenneyoptical.com",
  "lenscrafters.com",
  "pearlevision.com",
  "visionworks.com",
  "americasbest.com",
  "eyemart.com",
  "eyemartexpress.com",
  "myeyedr.com",
  "warbyparker.com",
  "stantonoptical.com",
  "bjs.com",
  "fullypromoted.com",
  "michaels.com",
  "joann.com",
  "hobbylobby.com",
  "staples.com",
  "officedepot.com",
  "fedex.com",
  "theupsstore.com",
  "vistaprint.com",
  "greatclips.com",
  "supercuts.com",
  "sportclips.com",
  "regissalons.com",
  // Print-and-apparel franchises, added when a real import carried two of them. A CSV listed
  // "Big Frog Custom T-Shirts Buckhead" as `bigfrog.com/buckhead` and "…Green Hills" as
  // `bigfrog.com/greenhills` — two franchises 350 miles apart whose paths are stripped by
  // `normalizeDomain`, leaving both holding the identical domain key.
  "bigfrog.com",
  "instantimprints.com",
  // Added when the demand rule promoted a FASTSIGNS branch to Tier 1. It has no website on its
  // listing, so only the name check could ever see it — which is precisely the case that check was
  // written for, and precisely why the list has to keep growing.
  "fastsigns.com",
  "signarama.com",
  "minutemanpress.com",
  "alphagraphics.com",
]);

/**
 * Whether a business **name** looks like one of the chains above.
 *
 * A separate and deliberately weaker signal than the domain match, for a case the domain match
 * cannot see: a chain whose Google listing carries no website at all. "Office Depot Print & Copy
 * Services" reached Tier 1 that way — 77 reviews, no domain, nothing for `sharedPlatformDomain` to
 * catch.
 *
 * **This returns a suspicion, never a verdict, and callers must not exclude on it.** Domains belong
 * to one company; names do not. "Michaels" is a craft chain and also the possessive of a very
 * common first name, and a list whose entire purpose is independent local businesses cannot afford
 * to silence "Michael's Braids" to catch it. The comment on CHAIN_DOMAINS says guessing would
 * silence real local businesses — that is truer of names than of domains, so this only ever raises
 * a flag for a human to settle.
 *
 * Anchored at the start because chains lead with their brand — "Office Depot Print & Copy", "Target
 * Optical", "Hobby Lobby". A business merely *mentioning* a chain later in its name is not one.
 */
export function nameMatchesChain(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalised = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalised.length === 0) return null;

  // The longest match wins, not the first. "Target Optical" starts with both `target` and
  // `targetoptical`, and iteration order would otherwise decide which chain gets named — reporting
  // the parent when the listing is plainly the optical arm. The flag would be right either way; the
  // name beside it would not.
  let best: string | null = null;
  for (const domain of CHAIN_DOMAINS) {
    const brand = domain.slice(0, domain.lastIndexOf("."));
    // Four characters is the shortest brand here that is not also an ordinary English word; below
    // that the token matches far too much to be worth showing anyone.
    if (brand.length < 4 || !normalised.startsWith(brand)) continue;
    if (best === null || brand.length > best.slice(0, best.lastIndexOf(".")).length) best = domain;
  }
  return best;
}

export type SharedDomainKind = "platform" | "chain";

export interface SharedDomainVerdict {
  kind: SharedDomainKind;
  /** The registrable domain that matched, e.g. "targetoptical.com". */
  matched: string;
  /** A sentence an operator can read next to the flag. */
  reason: string;
}

/**
 * Returns why a domain does not belong to this local business, or null when it looks like the
 * business's own.
 *
 * Matching is on the **registrable domain**, so `local.targetoptical.com`,
 * `locations.jcpenneyoptical.com` and `heavenly-hands-crocheting.square.site` all match while an
 * independent shop's own domain does not.
 */
export function sharedPlatformDomain(domain: string | null | undefined): SharedDomainVerdict | null {
  if (!domain) return null;

  const parsed = parse(domain.toLowerCase().trim());
  const registrable = parsed.domain;
  if (!registrable) return null;

  // `square.site` and friends are public suffixes to tldts in some cases and ordinary domains in
  // others, so the full hostname is checked too rather than relying on one of the two.
  const candidates = [registrable, parsed.hostname ?? "", domain.toLowerCase().trim()];

  for (const candidate of candidates) {
    for (const suffix of PLATFORM_DOMAINS) {
      if (candidate === suffix || candidate.endsWith(`.${suffix}`)) {
        return {
          kind: "platform",
          matched: suffix,
          reason: `The listed website is a ${suffix} profile, not this business's own site — the checks below describe that platform's page, not theirs.`,
        };
      }
    }
    for (const suffix of CHAIN_DOMAINS) {
      if (candidate === suffix || candidate.endsWith(`.${suffix}`)) {
        return {
          kind: "chain",
          matched: suffix,
          reason: `The listed website is the national ${suffix} site, not this location's own — the checks below describe the chain, not this branch.`,
        };
      }
    }
  }

  return null;
}
