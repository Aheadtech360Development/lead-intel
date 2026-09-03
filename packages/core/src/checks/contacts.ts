import { sharedPlatformDomain } from "../normalize/shared-domain.js";
import type { PageFacts } from "./parse.js";

/**
 * Contact details taken from the business's **own website** — free, already fetched, and until
 * now thrown away.
 *
 * The crawler has been reading /about and /contact pages since Phase 4 and pulling emails out of
 * them for the K7 check. Those addresses were stored inside a finding's `detail` and never shown
 * anywhere: 73 of 209 businesses had one, several of them the owner's own
 * (`diane@fibercircleyarn.com`). This module promotes that from a by-product of a check into what
 * it actually is — the contact you use to reach the business.
 *
 * Nothing here is guessed. A name is only returned when the page says outright that this person
 * owns or founded the business; a page that merely mentions a human being yields nothing.
 */

export interface SiteContacts {
  /** Best email for reaching the business, if any was published. */
  email: string | null;
  /** Every distinct email found, in the order found. Shown so the operator can pick another. */
  allEmails: string[];
  /** A phone number written on the site — which may differ from the one Google lists. */
  phone: string | null;
  /** The owner's or founder's name, only where the page states it plainly. */
  ownerName: string | null;
  /** Where the name came from, so the operator can judge it: "about page", "structured data". */
  ownerNameSource: string | null;
}

/**
 * Mailbox names that belong to a machine or a mailing list rather than to anyone who will answer.
 * Kept out of `email` but still listed in `allEmails` — they are real addresses, just not useful
 * ones to open with.
 */
const NON_HUMAN_MAILBOXES = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "postmaster",
  "abuse",
  "webmaster",
  "privacy",
  "unsubscribe",
  "bounce",
  "mailer-daemon",
]);

/**
 * Ranked best-first. A named mailbox is worth more than a shared one, because someone specific
 * reads it — but a generic address that a person answers still beats no address at all.
 */
const MAILBOX_PRIORITY = ["hello", "info", "contact", "sales", "enquiries", "inquiries", "office", "admin", "orders"];

export function extractContacts(pages: PageFacts[], domain: string | null): SiteContacts {
  const emails = collectEmails(pages, domain);
  const owner = findOwnerName(pages);

  return {
    email: pickBestEmail(emails, domain),
    allEmails: emails,
    phone: pages.flatMap((p) => p.telHrefs).map(cleanTelHref).find((v) => v !== null) ?? null,
    ownerName: owner?.name ?? null,
    ownerNameSource: owner?.source ?? null,
  };
}

function collectEmails(pages: PageFacts[], domain: string | null): string[] {
  const found = new Set<string>();

  for (const page of pages) {
    for (const href of page.mailtoHrefs) {
      const address = href.replace(/^mailto:/i, "").split("?")[0]?.trim().toLowerCase();
      if (address && isUsable(address, domain)) found.add(address);
    }
    for (const match of page.text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
      const address = match[0].toLowerCase();
      if (isUsable(address, domain)) found.add(address);
    }
  }

  return [...found];
}

/**
 * Rejects addresses that are real but not this business's.
 *
 * The live data made the case: `help.us@booksy.com` was stored against a braiding salon. It is a
 * genuine address — Booksy's support desk — and mailing it would reach a booking platform in
 * Poland rather than the salon in Mesquite. The same `sharedPlatformDomain` that keeps chain and
 * platform records out of the Stage 5 gate does the work here.
 */
function isUsable(address: string, domain: string | null): boolean {
  if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(address)) return false;
  if (/@\dx\b/i.test(address)) return false;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(address)) return false;
  if (/^(you|your|name|email|username|user|someone)@(example|domain|yourdomain|email|sentry)\./i.test(address)) {
    return false;
  }

  const host = address.split("@")[1] ?? "";
  if (sharedPlatformDomain(host)) return false;

  // A Gmail or Yahoo address on a business's own site is normal for a small trader and is kept.
  // What is rejected above is a *platform's* address, which belongs to somebody else entirely.
  void domain;
  return true;
}

function pickBestEmail(emails: string[], domain: string | null): string | null {
  if (emails.length === 0) return null;

  const usable = emails.filter((e) => !NON_HUMAN_MAILBOXES.has(e.split("@")[0] ?? ""));
  if (usable.length === 0) return null;

  const registrable = domain?.replace(/^www\./i, "").toLowerCase() ?? null;
  const onOwnDomain = usable.filter((e) => registrable !== null && (e.split("@")[1] ?? "").endsWith(registrable));
  const pool = onOwnDomain.length > 0 ? onOwnDomain : usable;

  // A named mailbox — diane@, sarah@ — reaches a person. Prefer it over a shared inbox.
  const named = pool.find((e) => {
    const mailbox = e.split("@")[0] ?? "";
    return !MAILBOX_PRIORITY.includes(mailbox) && !mailbox.includes(".") && mailbox.length >= 3;
  });
  if (named) return named;

  for (const preferred of MAILBOX_PRIORITY) {
    const match = pool.find((e) => (e.split("@")[0] ?? "") === preferred);
    if (match) return match;
  }
  return pool[0] ?? null;
}

function cleanTelHref(href: string): string | null {
  const raw = decodeURIComponent(href.replace(/^tel:/i, "")).trim();
  return raw.length >= 7 ? raw : null;
}

/**
 * The owner's name — and only when the page says so.
 *
 * Two sources, both explicit:
 *
 * 1. **Structured data.** A `founder` or a `Person` inside the business's own JSON-LD is the site
 *    stating, in machine-readable form, who this is.
 * 2. **A labelled line of text.** "Owner: Diane Michaels", "Founded by Sarah Kelly".
 *
 * What is deliberately *not* done: taking any capitalised name near the word "about", or the
 * author of a blog post, or the person in a testimonial. Those are guesses, and a guessed name is
 * worse than none — an operator opens a call with it and is immediately wrong about who they are
 * speaking to.
 */
function findOwnerName(pages: PageFacts[]): { name: string; source: string } | null {
  for (const page of pages) {
    const structured = page.ownerNames[0];
    if (structured && isPlausibleName(structured)) {
      return { name: structured, source: "the site's own structured data" };
    }
  }

  for (const page of pages) {
    for (const pattern of [LABELLED_OWNER, FOUNDED_BY]) {
      const match = pattern.exec(page.text);
      const name = match?.[1]?.trim();
      if (name && isPlausibleName(name)) {
        return { name, source: page.role === "homepage" ? "their homepage" : `their ${page.role} page` };
      }
    }
  }

  return null;
}

/**
 * Both are written **without** the `i` flag on purpose.
 *
 * The label may be capitalised either way, so both cases are spelled out — but the *name* must
 * begin with a capital, and a case-insensitive regex would make `[A-Z]` match lowercase too. That
 * would turn "owner: the shop next door" into a person called "the".
 */
/**
 * The `(?<![\w/])` is the fix for a real false positive found on live data.
 *
 * `maatiibeautysupply.com` carries a customer review reading *"I love the new management/owner -
 * Happy Customer Neet and lots of options"*. The old pattern read that as an owner called "Happy
 * Customer Neet". The tell is the character immediately before the label: a genuine label starts a
 * phrase, so it follows a space or the start of the text — never a slash, and never the tail of
 * another word.
 */
const LABELLED_OWNER =
  /(?<![\w/])(?:[Cc]o-)?(?:[Oo]wner|[Ff]ounder|[Pp]roprietor|[Pp]rincipal|[Mm]anaging [Dd]irector)\s*(?:and\s+\w+\s*)?[:\-–—]\s*([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})/;

const FOUNDED_BY =
  /\b(?:[Ff]ounded|[Oo]wned|[Ss]tarted|[Rr]un)\s+by\s+([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2})/;


/** Words that arrive from these patterns but are not anybody's name. */
const NOT_NAMES = new Set([
  "The", "Our", "We", "Us", "This", "That", "A", "An", "And", "Or", "For", "With",
  "Owner", "Founder", "Team", "Company", "Business", "Family", "Staff", "Management",
  // Defence in depth against review sections, which is where the one live false positive came
  // from. The lookbehind above already rejects that particular sentence; these catch the shape
  // of it rather than the one instance.
  "Customer", "Customers", "Client", "Clients", "Happy", "Satisfied", "Verified",
  "Reviewer", "Guest", "Visitor", "Anonymous", "Reviews", "Review", "Testimonial",
]);

function isPlausibleName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 3) return false;
  if (words.some((w) => NOT_NAMES.has(w))) return false;
  // A name is letters, apostrophes and hyphens — never digits or punctuation.
  return words.every((w) => /^[A-Z][a-zA-Z'’-]*$/.test(w));
}
