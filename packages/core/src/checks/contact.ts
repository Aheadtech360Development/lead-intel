import { normalizePhone } from "../normalize/phone.js";
import { absenceBlindSpot } from "./coverage.js";
import type { PageFacts } from "./parse.js";
import { fired, notApplicable, notMeasured, passed } from "./result.js";
import { BOOKING_WIDGET_SIGNATURES, CRM_WIDGET_SIGNATURES, detect } from "./signatures.js";
import type { CheckResult, SiteEvidence } from "./types.js";

/**
 * §5.2 — the CON area. "For a local business this is the whole point of the website. If a
 * customer cannot easily call, find, or message them, nothing else matters."
 *
 * Every check here asks whether something is *anywhere on the site*, and that phrasing is what
 * makes this family the most dangerous one to get wrong. On a real small-business site the phone
 * number, the address, the opening hours and the enquiry form usually live on /contact, not on
 * the homepage. Reading only the homepage and reporting "no phone number on the site" would be
 * inventing findings at scale — and an operator would take that invention onto a sales call.
 *
 * So absence is only ever concluded when the crawler actually got to the page most likely to
 * hold the answer. `conclude()` below is where that rule lives, and it applies asymmetrically on
 * purpose: **finding something is conclusive wherever we found it; not finding it requires that
 * we looked in the right place.**
 */
export function runContactChecks(evidence: SiteEvidence, pages: PageFacts[]): CheckResult[] {
  const ids = ["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8"];
  if (pages.length === 0) {
    return ids.map((id) => notMeasured(id, "The site could not be read, so nothing about contactability was checked."));
  }

  const coverageNote = absenceBlindSpot(evidence, pages);

  /**
   * `found` is positive evidence and settles the check on its own. Absence only settles it when
   * there is no blind spot; otherwise the check reports itself unmeasured with the reason.
   */
  const conclude = (
    id: string,
    found: boolean,
    foundEvidence: string,
    missingEvidence: string,
    detail?: Record<string, unknown>,
  ): CheckResult => {
    if (found) return passed(id, foundEvidence, detail);
    if (coverageNote) return notMeasured(id, coverageNote, detail);
    return fired(id, missingEvidence, detail ? { detail } : {});
  };

  const phones = findPhones(pages);
  const telLinks = pages.flatMap((page) => page.telHrefs);
  const emails = findEmails(pages);
  const formPages = pages.filter((page) => page.forms.withMessageField > 0);
  const embeddedForms = pages.flatMap((page) => detect(page.haystack, CRM_WIDGET_SIGNATURES));
  const hasForm = formPages.length > 0 || embeddedForms.length > 0;
  const bookingTools = pages.flatMap((page) => detect(page.haystack, BOOKING_WIDGET_SIGNATURES));

  const hasPhone = phones.length > 0 || telLinks.length > 0;
  const pagesRead = pages.map((page) => page.role);

  return [
    conclude(
      "K1",
      hasPhone,
      `A phone number is shown on the site${phones[0] ? ` (${phones[0]})` : ""}.`,
      "No phone number appears anywhere on the site — a customer who wants to call has nothing to call.",
      { phones: phones.slice(0, 3), telLinks: telLinks.length, pagesRead },
    ),

    // K2 is about *how* the number is presented, so it only means anything once there is one.
    !hasPhone
      ? notApplicable("K2", "There is no phone number on the site to make tappable.")
      : telLinks.length > 0
        ? passed("K2", "The phone number is a tap-to-call link.", { telLinks: telLinks.length })
        : fired("K2", "The phone number is plain text, not a tap-to-call link — on a phone a customer has to copy it out by hand."),

    conclude(
      "K3",
      hasForm,
      embeddedForms.length > 0
        ? `The site has an enquiry form (${embeddedForms.join(", ")}).`
        : "The site has a contact form with a message field.",
      "There is no contact form on the site — the only way to reach this business is to phone them.",
      { formPages: formPages.map((page) => page.role), embeddedForms },
    ),

    conclude(
      "K4",
      pages.some(hasAddress),
      "A street address is shown on the site.",
      "No street address appears on the site, so a customer cannot tell where this business is.",
      { pagesRead },
    ),

    conclude(
      "K5",
      pages.some(hasOpeningHours),
      "Opening hours are shown on the site.",
      "The site does not show opening hours, so a customer has no way to know when to call or visit.",
      { pagesRead },
    ),

    conclude(
      "K6",
      pages.some(hasMapOrDirections),
      "The site offers a map or directions.",
      "There is no map and no directions link — a customer has to work out how to get there themselves.",
      { pagesRead },
    ),

    conclude(
      "K7",
      emails.length > 0,
      `An email address is shown on the site${emails[0] ? ` (${emails[0]})` : ""}.`,
      "No email address appears anywhere on the site.",
      { emails: emails.slice(0, 3), pagesRead },
    ),

    conclude(
      "K8",
      bookingTools.length > 0 || hasForm || pages.some(hasQuoteCta),
      bookingTools.length > 0
        ? `The site has a booking tool (${bookingTools.join(", ")}).`
        : "The site offers a way to request a quote or booking.",
      "There is no booking tool, quote form, or call-to-action — a ready customer has no next step to take.",
      { bookingTools, hasForm },
    ),
  ];
}

/** How many whitespace-separated tokens one phone number may span: "+1 (305) 555 0100". */
const MAX_PHONE_TOKENS = 4;

/**
 * Finds every phone number on the pages, validated with the same `normalizePhone` the rest of the
 * system uses. Validation is what stops a price, an SKU or a copyright year being read as a phone
 * number, which a bare regex on its own does constantly.
 *
 * Candidates are built from **windows of consecutive tokens** rather than by scanning for one
 * long run of phone-ish characters, and that difference is not cosmetic. A single greedy regex on
 * `... TX 75442 972-782-6630 Mon ...` matches `75442 972-782-6630` — fifteen digits, not a valid
 * number — and having consumed the text, never tries the real number inside it. Since an address
 * and a phone sit next to each other on virtually every local business site, that failure fired
 * "no phone number on the site" at 30 points on sites that plainly show one. Trying each window
 * independently means the one-token candidate is still tested when the two-token one fails.
 */
function findPhones(pages: PageFacts[]): string[] {
  const found = new Set<string>();

  for (const page of pages) {
    for (const href of page.telHrefs) {
      const normalized = normalizePhone(decodeURIComponent(href.replace(/^tel:/i, "")));
      if (normalized) found.add(normalized.e164);
    }

    const tokens = page.text.split(/\s+/);
    for (let start = 0; start < tokens.length; start++) {
      // A number never begins mid-word, and skipping tokens with no digit at all keeps this from
      // becoming a quadratic walk over ordinary prose.
      if (!/\d/.test(tokens[start] ?? "")) continue;

      for (let span = 1; span <= MAX_PHONE_TOKENS && start + span <= tokens.length; span++) {
        const candidate = tokens.slice(start, start + span).join(" ");
        if (!/^[+(]?[\d\s().+-]+$/.test(candidate)) break; // hit a word — longer windows cannot help
        const digits = candidate.replace(/\D/g, "");
        if (digits.length > 15) break;
        if (digits.length < 10) continue;
        const normalized = normalizePhone(candidate);
        if (normalized) found.add(normalized.e164);
      }
    }
  }

  return [...found];
}

function findEmails(pages: PageFacts[]): string[] {
  const found = new Set<string>();

  for (const page of pages) {
    for (const href of page.mailtoHrefs) {
      const address = href.replace(/^mailto:/i, "").split("?")[0]?.trim();
      if (address && isPlausibleEmail(address)) found.add(address.toLowerCase());
    }
    for (const match of page.text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
      const address = match[0];
      if (isPlausibleEmail(address)) found.add(address.toLowerCase());
    }
  }

  return [...found];
}

/** Filters out the things that look like an address but are not: image srcsets ("logo@2x.png"),
 *  package names, and sample addresses that ship with themes. */
function isPlausibleEmail(address: string): boolean {
  if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(address)) return false;
  if (/@\dx\b/i.test(address)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(address)) return false;
  if (/^(you|your|name|email|username|user|someone|info)@(example|domain|yourdomain|email|sentry)\./i.test(address)) return false;
  return true;
}

/**
 * K4. Three independent ways a site can show an address, in descending order of certainty:
 * declared structured data, the `<address>` element, or a street line and a state-and-ZIP
 * appearing in the text. The last one requires *both* halves — a five-digit number alone is a
 * price as often as it is a postcode.
 */
function hasAddress(page: PageFacts): boolean {
  if (page.schemaHasPostalAddress) return true;
  if (page.addressElementText && page.addressElementText.length >= 10) return true;

  // A house number, then up to four name tokens, then a street suffix. The name tokens have to
  // allow digits: "123 NW 5th Ave" is an ordinary American address, and a pattern that assumed
  // the street name began with a letter missed every numbered street in the country.
  const hasStreetLine =
    /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,4}(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ste|suite|unit|trail|terrace|circle|cir)\b\.?/i.test(
      page.text,
    );
  const hasStateAndZip = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(page.text);

  return hasStreetLine && hasStateAndZip;
}

/**
 * K5. Structured data settles it; otherwise two or more day names alongside a clock time is what
 * a published opening-hours table looks like. Requiring two days is deliberate — a single
 * "Saturday" in a blog post next to "3:00" would otherwise read as a business schedule.
 */
function hasOpeningHours(page: PageFacts): boolean {
  if (page.schemaHasOpeningHours) return true;

  const days = new Set<string>();
  for (const match of page.text.matchAll(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|s|nesday|rsday|urday)?\b/gi)) {
    days.add((match[1] ?? "").slice(0, 3).toLowerCase());
  }
  if (days.size < 2) return false;

  // A clock time anywhere on a page that already names two days.
  if (/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(page.text)) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(page.text)) return true;

  // "Thurs 10-5", "Sat 10-4", "Sun closed" — how a small business actually writes its hours, with
  // no colon and no am/pm anywhere. Requiring one of those missed real opening-hours tables and
  // fired a 15-point finding on shops that publish them plainly.
  return /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s*[:\-–—]?\s*(closed|\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–—]\s*\d{1,2})/i.test(
    page.text,
  );
}

function hasMapOrDirections(page: PageFacts): boolean {
  const mapHost = /google\.[a-z.]{2,6}\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com|openstreetmap\.org|mapbox\.com|bing\.com\/maps|waze\.com/i;
  if (page.iframeSrcs.some((src) => mapHost.test(src))) return true;
  if (page.linkHrefs.some((href) => mapHost.test(href))) return true;
  if (page.ctaTexts.some((text) => /\b(get )?directions\b|find us on the map|view (on|in) map/i.test(text))) return true;
  return false;
}

/**
 * K8 asks for "a booking widget, quote form, or call-to-action" — a next step a ready customer
 * can take. What counts is an offer to *start something*: a quote, a booking, an order, a free
 * audit or consultation.
 *
 * A plain "Contact us" link deliberately does not count. Almost every site on the web has one, so
 * accepting it would mean K8 never fires and quietly becomes decoration — and having a phone
 * number and a contact form is already what K1 and K3 measure. Adding "free audit" and its
 * relatives came from a live run: a real agency site offering a free audit on every page was
 * being told it had no call to action at all.
 */
function hasQuoteCta(page: PageFacts): boolean {
  const cta =
    /\b(get|request|claim|book|start|grab)\s+(a\s+|your\s+|my\s+)?(free\s+)?(quote|estimate|consultation|assessment|audit|analysis|review|demo|trial|sample)\b|\bfree (quote|estimate|consultation|audit|assessment|analysis|demo|trial|sample)\b|\bbook (now|online|an? appointment|a table)\b|\bschedule (a|an|your)\b|\bmake an appointment\b|\brequest (a )?(callback|call ?back|service|info)\b|\bstart your (order|project)\b|\b(order|shop|buy) (now|online)\b|\bget started\b/i;
  return page.ctaTexts.some((text) => cta.test(text));
}
