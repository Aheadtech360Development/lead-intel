import { IDENTITY_KEY_RANK, type IdentityKey } from "@lead-intel/shared";
import type { CountryCode } from "libphonenumber-js";
import { normalizeDomain } from "../normalize/domain.js";
import { normalizeLocation, type LocationInput } from "../normalize/location.js";
import { normalizeName } from "../normalize/name.js";
import { normalizePhone } from "../normalize/phone.js";
import { sharedPlatformDomain } from "../normalize/shared-domain.js";

export interface IdentityKeyMaterial {
  placeId?: string | null;
  /** Raw domain or URL — normalised internally. */
  domain?: string | null;
  /** Raw phone number — normalised internally. */
  phone?: string | null;
  fbPageId?: string | null;
  /** Raw business name — normalised internally, used only for the rank-5 key. */
  name?: string | null;
  location?: LocationInput;
  defaultPhoneCountry?: CountryCode;
}

/**
 * Builds every identity key this business currently supports, per spec §7 rank table:
 *   1 place_id · 2 domain · 3 phone · 4 fb_page_id · 5 name_location
 *
 * Every key that can be constructed is returned — a business can and usually does carry more
 * than one. Rank 3 (phone) is deliberately *not* accompanied by a normalised name requirement
 * here; the "phone + name" pairing spec §7 describes is about merge behaviour (a phone alone
 * never merges two records — see packages/core/src/merge), not about whether the key exists.
 *
 * Rank 5 requires *both* a usable name and a usable location — neither alone is a safe key.
 */
export function buildIdentityKeys(material: IdentityKeyMaterial): IdentityKey[] {
  const keys: IdentityKey[] = [];

  if (material.placeId && material.placeId.trim().length > 0) {
    keys.push({ keyType: "place_id", keyValue: material.placeId.trim(), rank: IDENTITY_KEY_RANK.place_id });
  }

  const domain = normalizeDomain(material.domain);
  if (domain && identifiesOneBusiness(domain)) {
    keys.push({ keyType: "domain", keyValue: domain, rank: IDENTITY_KEY_RANK.domain });
  }

  const phone = normalizePhone(material.phone, material.defaultPhoneCountry ?? "US");
  if (phone) {
    keys.push({ keyType: "phone", keyValue: phone.e164, rank: IDENTITY_KEY_RANK.phone });
  }

  if (material.fbPageId && material.fbPageId.trim().length > 0) {
    keys.push({ keyType: "fb_page_id", keyValue: material.fbPageId.trim(), rank: IDENTITY_KEY_RANK.fb_page_id });
  }

  const name = normalizeName(material.name);
  const location = material.location ? normalizeLocation(material.location) : null;
  if (name && location) {
    keys.push({
      keyType: "name_location",
      keyValue: `${name}::${location.locationHash}`,
      rank: IDENTITY_KEY_RANK.name_location,
    });
  }

  return keys.sort((a, b) => a.rank - b.rank);
}

/**
 * Whether a domain names *this* business rather than a platform or a chain that thousands of
 * businesses share.
 *
 * Rank 2 is a strong key: two records holding the same domain merge automatically. That is right
 * when the domain belongs to the business and wrong when it does not, and a real import proved how
 * wrong. The file listed "Big Frog Custom T-Shirts Buckhead" (Atlanta) as `bigfrog.com/buckhead`
 * and "Big Frog Custom T-Shirts Green Hills" (Nashville) as `bigfrog.com/greenhills`.
 * `normalizeDomain` strips paths — a website is identified by its host — so both arrived as
 * `bigfrog.com`, and the second row would have been merged into the first: two franchises 350
 * miles apart collapsed into one record, with no warning and nothing in the UI to show it had
 * happened.
 *
 * The test is **equality with the shared domain, not a match against it.** A per-business
 * subdomain is still that business's own address: `rjgraphicsanddesign.myshopify.com` and
 * `heavenly-hands.square.site` name exactly one shop each and keep their key. Only the bare shared
 * domain — `bigfrog.com`, `booksy.com`, `instantimprints.com` — is refused, because it names all of
 * them at once.
 *
 * A record refused here still keeps its phone and name+location keys, so it deduplicates by the
 * evidence that genuinely distinguishes it. It also stops being crawled, since the crawler follows
 * the domain key — and that is the correct outcome, not a loss: crawling `bigfrog.com` would
 * produce a page full of findings about the franchisor and file them under a shop in Buckhead.
 */
function identifiesOneBusiness(domain: string): boolean {
  const verdict = sharedPlatformDomain(domain);
  return verdict === null || domain !== verdict.matched;
}

/** The strongest (lowest-numbered) key in a set, or null if the set is empty. */
export function strongestKey(keys: IdentityKey[]): IdentityKey | null {
  if (keys.length === 0) return null;
  return keys.reduce((best, k) => (k.rank < best.rank ? k : best));
}

/** True if this key set includes a rank 1 or 2 key — the two ranks the late-merge auto-merge
 *  test (spec §7, build guide §3.4) allows to trigger an automatic merge. */
export function hasStrongKey(keys: IdentityKey[]): boolean {
  return keys.some((k) => k.rank === 1 || k.rank === 2);
}
