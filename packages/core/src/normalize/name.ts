/**
 * Business-name suffixes that don't distinguish one business from another for identity purposes.
 * Deliberately conservative — dropping a real word from the name is worse than keeping an extra
 * "llc". This list only removes standalone legal/entity suffixes at the end of the name.
 *
 * "co" and "company" are deliberately NOT on this list, even though they are common suffixes.
 * Unlike "llc" or "inc", they are also genuinely part of some businesses' actual names — "The
 * Sign Company", "Fern & Field Co" — and stripping them risks two distinct businesses
 * normalising to the same name. nameSimilarity() already tolerates one extra/missing word via
 * Jaccard overlap, so the marginal benefit of stripping these doesn't justify that risk.
 */
const TRAILING_SUFFIXES = [
  "llc",
  "l l c",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "ltd",
  "limited",
  "llp",
  "lp",
  "pllc",
  "pc",
];

// Combining diacritical marks, U+0300 to U+036F — built from code points rather than written as
// a literal character class, so the source file never contains an actual combining character
// that an editor could silently reinterpret.
const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;
const COMBINING_MARKS = new RegExp(
  `[\\u${COMBINING_MARKS_START.toString(16).padStart(4, "0")}-\\u${COMBINING_MARKS_END.toString(16).padStart(4, "0")}]`,
  "g",
);

/**
 * Normalises a business name for identity comparison: lowercase, punctuation stripped,
 * whitespace collapsed, one trailing legal-entity suffix removed.
 *
 * This is for *matching*, not for display — never show `normalizeName()` output to an operator.
 */
export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "") // strip accents left behind by NFKD (e.g. é -> e + accent -> e)
    // Apostrophes (straight or curly) are removed with NO space — "Artee's" -> "artees", not
    // "artee s". Splitting on the apostrophe would break the name into two words and wreck
    // similarity matching. Every other punctuation mark (hyphens, ampersands, periods, ...) DOES
    // become a space, since those genuinely separate words: "Screen-Printing" -> "screen printing".
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // remaining punctuation -> space
    .replace(/\s+/g, " ")
    .trim();

  if (s.length === 0) return null;

  const words = s.split(" ");
  const last = words[words.length - 1];
  if (words.length > 1 && last !== undefined && TRAILING_SUFFIXES.includes(last)) {
    words.pop();
    s = words.join(" ");
  }

  return s.length > 0 ? s : null;
}

/**
 * Similarity between two normalised names, 0 to 1, via word-level Jaccard overlap.
 * Used by the late-merge auto-merge test (spec §7 / build guide §3.4) — never used alone to
 * establish identity, only as one signal alongside a rank 1–2 key match.
 */
export function nameSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
