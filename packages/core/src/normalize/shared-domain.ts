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
]);

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
