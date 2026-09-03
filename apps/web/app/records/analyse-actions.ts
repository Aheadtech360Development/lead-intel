"use server";

import type { analyseRunTask } from "@lead-intel/jobs/analyse";
import { tasks } from "@trigger.dev/sdk";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts the free analysis for businesses that have never had it.
 *
 * This is the button that should have existed the day the importer did. Importing created 121
 * businesses and told the operator to "run the website analysis" — a thing only possible from a
 * terminal. The rows sat reading "Not scored / Couldn't check", which is indistinguishable from
 * 121 businesses whose sites are genuinely broken.
 *
 * As everywhere else, Next.js only enqueues. The crawl, PageSpeed and the scoring all happen on
 * the worker, which is where the database service role and every provider key live.
 *
 * **Nothing here spends money.** The crawl is ours, PageSpeed is free, scoring is arithmetic.
 */
export async function analyseUnscored(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records?error=${encodeURIComponent("You are not signed in.")}`);
  }

  // Empty means "everything not yet analysed", which is what the banner offers. A list of ids is
  // accepted so the same action can later serve a ticked selection without a second code path.
  const businessIds = formData.getAll("id").map(String).filter(Boolean);
  const back = String(formData.get("back") ?? "/records");

  try {
    // Categorised as well as analysed, so this button leaves a business in the same state an import
    // or a search would. It reads stored text and costs nothing, and a business that has just been
    // read for the first time is exactly the one whose category was previously unknowable.
    await tasks.trigger<typeof analyseRunTask>("analyse-run", { businessIds, categoriseAll: true });
  } catch (err) {
    // Surfaced rather than swallowed. An operator who pressed "Analyse" and saw a cheerful message
    // while nothing ran would wait for scores that were never coming — the same failure the
    // discovery and enrich flows both take care to avoid.
    redirect(
      `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(
        `Could not start the analysis: ${err instanceof Error ? err.message : String(err)}. ` +
          `Nothing was changed. This usually means the background worker is not running.`,
      )}`,
    );
  }

  redirect(
    `${back}${back.includes("?") ? "&" : "?"}bought=${encodeURIComponent(
      "Analysis started. Their websites are being read now, then measured for speed, then scored, " +
        "then sorted into your categories — it costs nothing. Refresh this page in a few minutes; " +
        "the “Couldn’t be scored” number will fall as they finish.",
    )}`,
  );
}

/**
 * Re-reads websites that were crawled before the crawler kept the page text.
 *
 * A separate action from `analyseUnscored` because it answers a different question. That one asks
 * "who has never been looked at"; every business here has been looked at, and the thing missing is
 * something the crawler did not used to store. Sharing one button would mean one of the two
 * meanings was wrong, and the wrong one is the silent kind: the analyse button correctly finds no
 * unanalysed businesses, reports success, and changes nothing — which is exactly what it did when
 * this was needed.
 *
 * Free, like every crawl. Nothing here touches a paid provider.
 */
export async function refreshWebsiteText(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/categories?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const back = String(formData.get("back") ?? "/categories");

  try {
    await tasks.trigger<typeof analyseRunTask>("analyse-run", {
      businessIds: [],
      refreshMissingField: "site_text",
      // Sorted afterwards, because the whole reason for re-reading is that the rules had nothing to
      // read. Re-reading and then not re-sorting would leave the operator looking at the same empty
      // categories and concluding the crawl had not worked.
      categoriseAll: true,
    });
  } catch (err) {
    redirect(
      `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(
        `Could not start the re-read: ${err instanceof Error ? err.message : String(err)}. ` +
          `Nothing was changed. This usually means the background worker is not running.`,
      )}`,
    );
  }

  redirect(
    `${back}${back.includes("?") ? "&" : "?"}applied=1&bought=${encodeURIComponent(
      "Re-reading their websites now to pick up the page text, then re-sorting everything through " +
        "your rules. It costs nothing and takes a few minutes. Refresh to watch the counts move.",
    )}`,
  );
}
