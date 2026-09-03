"use server";

import {
  buildIdentityKeys,
  normalizeName,
  parseBusinessCsv,
  sharedPlatformDomain,
  type ImportRow,
} from "@lead-intel/core";
import type { analyseRunTask } from "@lead-intel/jobs/analyse";
import { tasks } from "@trigger.dev/sdk";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * What the operator decided this file is for, chosen before the import runs.
 *
 * It exists because every import used to do the same thing to every file, and the operator had no
 * way to say what a particular list was for. One file is 129 apparel brands they want sorted and
 * looked up on Instagram; the next is a list of shops they only want scored. Those are different
 * jobs, and the difference is worth money — so it is asked once, written down, and readable
 * afterwards on the file's own page.
 *
 * **Meta ads is deliberately not a field here.** The operator's instruction was explicit: ads get
 * picked business by business, by hand, never as part of a batch. Leaving it out of the type is a
 * stronger guarantee than leaving it unticked, because there is nothing to tick by accident.
 */
export interface ImportPlan {
  /** Crawl their websites and run the 51 checks. Free. */
  analyseWebsites: boolean;
  /** Sort them with the category rules once the crawl has something to read. Free. */
  applyCategories: boolean;
  /**
   * Go on to buy Instagram for this file's businesses. **This does not spend anything by itself** —
   * it carries the operator to the priced confirm screen with this batch already selected. The
   * money still moves only on that screen, which is the one place in the product that spends.
   */
  instagram: boolean;
  /** The operator's own note about what this file is, shown on the batch page. */
  note: string | null;
}

export interface ImportPreview {
  willCreate: ImportRow[];
  /** Rows whose identity keys already belong to a business — these merge rather than duplicate. */
  willMerge: Array<{ row: ImportRow; existingName: string; matchedOn: string }>;
  /**
   * Rows that share a normalised name and town with an existing record but no strong key.
   *
   * These are **created, and flagged for a human**, never merged automatically. A CSV has no
   * coordinates, so its name+location identity key can never equal the one a Google Maps result
   * produces (`place:us:tx:dallas` versus `geo:32.99:-96.84`) — which means the weakest key
   * cannot do this job here. Matching on the stored name and city instead is the same evidence,
   * and §7 already says what to do with it: rank 5 is evidence, not proof, so it goes to review
   * rather than folding two records together on a name two businesses might share.
   */
  possibleDuplicates: Array<{ row: ImportRow; existingName: string; existingId: string }>;
  /**
   * Rows whose "website" is a chain's or a booking platform's own address rather than this
   * business's. They import — the name, phone and town are real — but their site is never
   * crawled, because crawling `bigfrog.com` would describe the franchisor and file the findings
   * under a shop in Buckhead.
   *
   * Surfaced here because the alternative is a business that imports, is never analysed, and sits
   * in the list unscored with nothing saying why.
   */
  sharedWebsites?: Array<{ row: ImportRow; matched: string; kind: string }>;
  rejected: Array<{ rowNumber: number; reason: string; value: string | null }>;
  columnMapping: Record<string, string>;
  unmatchedColumns: string[];
  totalDataRows: number;
}

/**
 * Reads the file and works out what *would* happen — without writing anything.
 *
 * The merge detection here is a plain look-up of each row's identity keys, which is the same
 * question `resolveBusinessForRawResult` asks when the import actually runs. It is a preview, not
 * a promise: between this and the confirm the answer could change, and the real run is what
 * decides. Showing it matters because "18 of these are already in your list" is the difference
 * between an operator importing confidently and an operator worrying about duplicates.
 */
export async function uploadImport(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (typeof userId !== "string") {
    redirect(`/records/import?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/records/import?error=${encodeURIComponent("No file was uploaded.")}`);
  }
  if (file.size > 5 * 1024 * 1024) {
    redirect(`/records/import?error=${encodeURIComponent("That file is larger than 5 MB. Split it and import in parts.")}`);
  }

  const parsed = parseBusinessCsv(await file.text());

  const willCreate: ImportRow[] = [];
  const willMerge: ImportPreview["willMerge"] = [];
  const possibleDuplicates: ImportPreview["possibleDuplicates"] = [];
  const sharedWebsites: NonNullable<ImportPreview["sharedWebsites"]> = [];

  for (const row of parsed.rows) {
    const shared = sharedPlatformDomain(row.domain);
    if (shared && row.domain === shared.matched) {
      sharedWebsites.push({ row, matched: shared.matched, kind: shared.kind });
    }

    const keys = buildIdentityKeys({
      name: row.name,
      domain: row.domain,
      phone: row.phone,
      location: row.city || row.state ? { city: row.city, state: row.state } : undefined,
    });

    let matched: { existingName: string; matchedOn: string } | null = null;
    for (const key of keys) {
      const { data } = await supabase
        .from("identity_keys")
        .select("business_id")
        .eq("key_type", key.keyType)
        .eq("key_value", key.keyValue)
        .maybeSingle();
      if (!data) continue;

      const { data: existing } = await supabase
        .from("businesses")
        .select("display_name")
        .eq("id", data.business_id)
        .maybeSingle();
      matched = {
        existingName: existing?.display_name ?? "an existing record",
        matchedOn: key.keyType.replace(/_/g, " "),
      };
      break;
    }

    if (matched) {
      willMerge.push({ row, ...matched });
      continue;
    }

    // No strong key matched. Before creating, check for a same-name, same-town record — the
    // evidence a CSV can offer in place of an identity key it cannot construct.
    const near = await findSameNameInTown(supabase, row);
    if (near) possibleDuplicates.push({ row, existingName: near.name, existingId: near.id });
    willCreate.push(row);
  }

  const preview: ImportPreview = {
    willCreate,
    willMerge,
    possibleDuplicates,
    sharedWebsites,
    rejected: parsed.rejected,
    columnMapping: parsed.columnMapping,
    unmatchedColumns: parsed.unmatchedColumns,
    totalDataRows: parsed.totalDataRows,
  };

  // Held rather than re-parsed on confirm, so what the operator approved and what gets imported
  // are literally the same object. Two parses of the same bytes ought to agree — but "ought to"
  // is not a guarantee worth resting an import on.
  const { data: batch, error } = await supabase
    .from("import_batches")
    .insert({
      created_by: userId,
      filename: file.name,
      parsed: preview,
      row_count: willCreate.length + willMerge.length,
    })
    .select("id")
    .single();

  if (error || !batch) {
    redirect(`/records/import?error=${encodeURIComponent(error?.message ?? "Could not read the file.")}`);
  }

  redirect(`/records/import?batch=${batch.id}`);
}

/** Throws the batch away without importing anything. */
export async function discardImport(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batch") ?? "");
  if (batchId) {
    const supabase = await createClient();
    await supabase.from("import_batches").update({ status: "discarded" }).eq("id", batchId);
  }
  redirect("/records/import");
}

/**
 * Writes the businesses the operator confirmed.
 *
 * Deliberately **not** its own deduplication logic. Every row goes through the same identity-key
 * path Google Maps results take, so an imported salon that was already discovered folds into the
 * existing record rather than becoming a second one — and it does so by the same rules, which is
 * what stops the two sources drifting into two different notions of "the same business".
 *
 * The crawl and the free checks are what happen next, and they cost nothing. **No paid lookup is
 * triggered by an import** — that stays a separate, priced, deliberate choice on the enrich
 * screen.
 */
export async function confirmImport(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records/import?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const batchId = String(formData.get("batch") ?? "");
  if (!batchId) {
    redirect(`/records/import?error=${encodeURIComponent("Nothing to import.")}`);
  }

  const { data: batch } = await supabase
    .from("import_batches")
    .select("parsed, status, filename")
    .eq("id", batchId)
    .maybeSingle();

  if (!batch || batch.status !== "pending") {
    redirect(
      `/records/import?error=${encodeURIComponent("That import has already been used. Upload the file again if you want to repeat it.")}`,
    );
  }

  // Read before anything is written, so a plan that fails to parse cannot leave half an import
  // behind. Checkbox absence means off, which is what an unticked box means in a form post.
  const plan: ImportPlan = {
    analyseWebsites: formData.get("analyseWebsites") === "on",
    applyCategories: formData.get("applyCategories") === "on",
    instagram: formData.get("instagram") === "on",
    note: String(formData.get("note") ?? "").trim() || null,
  };

  const preview = batch.parsed as ImportPreview;
  const rows: ImportRow[] = [...preview.willCreate, ...preview.willMerge.map((m) => m.row)];
  // Row numbers are unique within one file, so they identify which created rows need flagging.
  const flagForReview = new Set(preview.possibleDuplicates.map((d) => d.row.rowNumber));

  let created = 0;
  let merged = 0;
  let failed = 0;
  /**
   * Every business this file touched, created or merged.
   *
   * Merged ones are included on purpose. A row that folded into an existing record may have
   * brought a website address that record did not have, and re-reading a site costs nothing — so
   * the cheap, correct thing is to analyse everything the file touched rather than reason about
   * which merges changed something worth re-reading.
   */
  const touched: string[] = [];

  for (const row of rows) {
    const keys = buildIdentityKeys({
      name: row.name,
      domain: row.domain,
      phone: row.phone,
      location: row.city || row.state ? { city: row.city, state: row.state } : undefined,
    });

    // Look for an existing owner of any of this row's keys. A single operator importing one file
    // is not the concurrent grid-search case that build guide §3.4 forbids pre-checking for — the
    // race it warns about does not exist here, and the manual-entry form takes the same view.
    let existingId: string | null = null;
    for (const key of keys) {
      const { data } = await supabase
        .from("identity_keys")
        .select("business_id")
        .eq("key_type", key.keyType)
        .eq("key_value", key.keyValue)
        .maybeSingle();
      if (data) {
        existingId = data.business_id;
        break;
      }
    }

    if (existingId) {
      await writeFields(supabase, existingId, row);
      touched.push(existingId);
      merged += 1;
      continue;
    }

    const needsReview = flagForReview.has(row.rowNumber);
    const { data: business, error } = await supabase
      .from("businesses")
      .insert({
        display_name: row.name,
        name_normalized: normalizeName(row.name),
        // Stamped only on rows this import *creates*. A row that merged into a business found by
        // a Maps search leaves that record `discovered`, because that is where it came from —
        // the file added fields to it, and `field_metadata.source_name` records that separately.
        origin: "imported" as const,
        import_batch_id: batchId,
        // Not "no_website" when the file gave no address — the file simply did not say. Recording
        // an absence the source never claimed would be exactly the guess §4 forbids.
        website_status: "unclear",
        city: row.city,
        state: row.state,
        // A same-name, same-town match is §7's rank-5 evidence: enough to raise, never enough to
        // merge on. The record is created and a human is asked, rather than two businesses being
        // silently folded together on a name they might simply share.
        manual_review_status: needsReview,
        manual_review_reasons: needsReview ? ["potential_duplicate"] : [],
      })
      .select("id")
      .single();

    if (error || !business) {
      failed += 1;
      continue;
    }

    if (keys.length > 0) {
      await supabase.from("identity_keys").insert(
        keys.map((k) => ({
          business_id: business.id,
          key_type: k.keyType,
          key_value: k.keyValue,
          rank: k.rank,
        })),
      );
    }

    await writeFields(supabase, business.id, row);
    touched.push(business.id);
    created += 1;
  }

  await supabase
    .from("import_batches")
    .update({ status: "imported", completed_at: new Date().toISOString(), plan })
    .eq("id", batchId);

  // Start what the plan asked for, rather than telling the operator to. An earlier version of this
  // message said "run the website analysis to score them" and there was no way to do that from the
  // application — 121 businesses were imported and sat unread, showing "Not scored" as though that
  // were a finding about them.
  //
  // Deliberately not fatal. The import has already happened and is correct; a worker that is not
  // running must not turn a successful import into an error page. The leads list carries an
  // "Analyse them now" button for exactly this case.
  //
  // Categorising is handed to the same task rather than triggered alongside it, because a category
  // rule reads the text the crawl produces. Fired in parallel it would sort this file's businesses
  // on evidence that does not exist yet, and quietly file most of them under nothing.
  let analysisStarted = false;
  if (plan.analyseWebsites || plan.applyCategories) {
    try {
      await tasks.trigger<typeof analyseRunTask>("analyse-run", {
        businessIds: plan.analyseWebsites ? touched : [],
        categoriseIds: plan.applyCategories ? touched : [],
        skipAnalysis: !plan.analyseWebsites,
      });
      analysisStarted = true;
    } catch {
      analysisStarted = false;
    }
  }

  const what =
    `Imported ${created} new businesses from ${batch.filename ?? "your file"}.` +
    (merged > 0
      ? ` ${merged} rows matched businesses you already had, so they were added to those records instead of being duplicated; those stay under "Found by search", because that is where they came from.`
      : "") +
    (preview.possibleDuplicates.length > 0
      ? ` ${preview.possibleDuplicates.length} are flagged as possible duplicates for you to check.`
      : "") +
    (failed > 0 ? ` ${failed} failed.` : "") +
    (plan.analyseWebsites && analysisStarted
      ? " Their websites are being read and scored now — it costs nothing. Refresh in a few minutes."
      : plan.analyseWebsites
        ? " Their websites have not been analysed yet — press “Analyse them now”. It costs nothing."
        : " You chose not to analyse their websites; you can start that at any time from the leads list.");

  // Instagram was asked for, so hand the operator to the screen that prices it — with this file
  // already selected. **Nothing has been bought at this point.** Money moves in exactly one place
  // in this product, and an import is not it; carrying the choice forward is not the same as
  // acting on it.
  if (plan.instagram) {
    redirect(
      `/records/enrich?scope=filtered&f_view=everything&f_batch=${batchId}&only=instagram_profile&note=${encodeURIComponent(
        `${what} You asked for their Instagram too — here is what that would cost for this file. Nothing has been bought yet.`,
      )}`,
    );
  }

  // Lands on the imported set alone rather than in the middle of everything else. That is the
  // whole request behind this feature: after uploading a file the operator wants to see what the
  // file gave them, not to hunt for it among businesses found by search.
  redirect(
    `/records?view=everything&batch=${batchId}&bought=${encodeURIComponent(
      `${what} You are looking at this file on its own — clear the file filter to see everything together.`,
    )}`,
  );
}

/**
 * An existing business with the same normalised name in the same town.
 *
 * An exact comparison of already-normalised values, not a similarity score — "Kirra's Braids" in
 * Dallas either matches "kirras braids"/"dallas" or it does not. Two genuinely different shops
 * can still share a name in one town, which is exactly why the caller flags rather than merges.
 */
async function findSameNameInTown(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: ImportRow,
): Promise<{ id: string; name: string } | null> {
  if (!row.city) return null;
  const { data } = await supabase
    .from("businesses")
    .select("id, display_name")
    .eq("status", "active")
    .eq("name_normalized", normalizeName(row.name))
    .eq("city", row.city.toLowerCase().trim())
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id, name: data.display_name } : null;
}

/** Every field carries `csv_import` as its source, so provenance survives the import. */
async function writeFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  row: ImportRow,
): Promise<void> {
  const fields = [
    row.domain ? { field_name: "website_url", value: row.domain } : null,
    row.phone ? { field_name: "phone", value: row.phone } : null,
    row.email ? { field_name: "contact_email", value: row.email } : null,
    row.address ? { field_name: "address", value: row.address } : null,
  ].filter((f): f is { field_name: string; value: string } => f !== null);

  if (fields.length === 0) return;

  for (const field of fields) {
    await supabase.from("field_metadata").upsert(
      {
        business_id: businessId,
        field_name: field.field_name,
        value: field.value,
        source_name: "csv_import",
        // The parser rejected anything unparseable before this point, so what is stored here has
        // passed the same validation the manual-entry form applies — which is what makes calling
        // it "verified" honest rather than habitual.
        verification_status: "verified" as const,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,field_name" },
    );
  }
}
