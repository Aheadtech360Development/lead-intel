import type { PageFacts } from "./parse.js";
import type { SiteEvidence } from "./types.js";

/**
 * Below this many characters of readable text, nothing meaningful was served at all — a nav bar
 * at most. Set deliberately low, because a thin real site is still a real site: `fibercircleyarn.com`
 * publishes its name, address, phone and opening hours in **277 characters** on a Weebly page,
 * and an earlier 300-character floor silenced every check on it. That is precisely the kind of
 * business this system exists to find.
 */
const MIN_READABLE_TEXT_CHARS = 150;

/**
 * The second signal, and the more reliable one: **the ratio of markup to content**. A rendered
 * app shell is enormous and says nothing — `needlepointthis.com` serves 95 KB of HTML containing
 * zero readable characters, `thistlecreativereuse.com` 62 KB of the same. A real small site is
 * the opposite shape: `fibercircleyarn.com` is 16 KB carrying 277 characters of actual address
 * and opening hours.
 *
 * Length alone cannot separate those two — 197 characters of navigation and 277 characters of
 * genuine content sit next to each other on any list. How much markup was spent to produce that
 * text can.
 */
const APP_SHELL_HTML_BYTES = 20_000;
const APP_SHELL_MAX_TEXT_CHARS = 400;

/**
 * Whether what the server handed us was actually the business's website.
 *
 * Returns a reason when it was not, and null when it was. Two things produce markup that is not
 * a website, and both are common enough on a list of small local businesses to matter:
 *
 * - **A single-page app with no server rendering.** The crawler gets an empty shell: no form, no
 *   phone number, no social links, no address — not because the business lacks them but because
 *   none of it exists until a browser runs the JavaScript.
 * - **A redirect or lander stub.** Found live: `texasoptical.net` serves 114 bytes whose entire
 *   content is `window.location.href="/lander"`. Judged as a page, it has no title, no meta
 *   description, no viewport tag, no tracking and one page total — ten findings, every one of
 *   them about a stub rather than about the business.
 *
 * Every check derived from page content is gated on this. The ones that are not — W4 (HTTPS),
 * S12 (sitemap), S13 (indexability), and W1–W3 (which restate the §4 presence verdict) — read
 * the connection, a probe, or robots.txt, and stay valid whatever the page turned out to be.
 */
export function pageContentBlindSpot(pages: PageFacts[]): string | null {
  const home = pages[0];
  if (!home) return "The site could not be read.";

  if (home.text.length < MIN_READABLE_TEXT_CHARS) {
    return `The address served ${home.text.length === 0 ? "no readable text at all" : `only ${home.text.length} characters of readable text`} — a redirect stub, or a site whose content only appears once a browser runs its JavaScript. Nothing about the page itself could be judged from it.`;
  }

  if (home.htmlBytes >= APP_SHELL_HTML_BYTES && home.text.length < APP_SHELL_MAX_TEXT_CHARS) {
    return `The address served ${Math.round(home.htmlBytes / 1024)} KB of markup carrying only ${home.text.length} characters of readable text — the signature of a page whose content appears only once a browser runs its JavaScript. Nothing about the page itself could be judged from it.`;
  }

  return null;
}

/**
 * Whether the "we looked and it is not there" checks are entitled to conclude anything.
 *
 * Everything `pageContentBlindSpot` covers, plus one more: **a contact page we linked to but
 * could not read.** On a real small-business site the phone number, the address, the hours and
 * the form live on /contact. Concluding "no phone number on the site" from a homepage we read
 * and a contact page we did not is how a system manufactures a finding, and an operator takes it
 * onto a sales call.
 *
 * It is the same mistake in different clothes, and it is the mistake this whole module is built
 * around not making: an absence of evidence is not evidence of absence.
 */
export function absenceBlindSpot(evidence: SiteEvidence, pages: PageFacts[]): string | null {
  const contentBlindSpot = pageContentBlindSpot(pages);
  if (contentBlindSpot) return contentBlindSpot;

  if (evidence.contactPageUnread) {
    return "The site links to a contact page that could not be read, so an absence here cannot be confirmed.";
  }

  return null;
}

/**
 * The same question for the social family, which has its own page it cannot afford to miss.
 *
 * Kept separate from `absenceBlindSpot` because the two blind spots are not interchangeable: an
 * unread contact page says nothing about social profiles, and an unread socials page says nothing
 * about whether a phone number is published. Folding them together would silence four checks
 * every time a contact page timed out, and the honest answer in each case is narrower than that.
 */
export function socialAbsenceBlindSpot(evidence: SiteEvidence, pages: PageFacts[]): string | null {
  const contentBlindSpot = pageContentBlindSpot(pages);
  if (contentBlindSpot) return contentBlindSpot;

  if (evidence.socialPageUnread) {
    return "The site links to a page listing their social profiles that could not be read, so we cannot say they have none.";
  }

  return null;
}
