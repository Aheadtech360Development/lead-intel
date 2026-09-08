"use server";

import { redirect } from "next/navigation";
import { buildIdentityKeys, normalizeDomain, normalizeName, normalizePhone } from "@lead-intel/core";
import { createClient } from "@/lib/supabase/server";

/**
 * Manual entry is a single human filling out a form sequentially — not the discovery pipeline's
 * many concurrent workers. Build guide §3.4 says never pre-check identity keys in the pipeline
 * (that's a real race there); here, a pre-check is the simpler and correct tool, because the
 * race it would guard against essentially doesn't exist for one person on one form.
 */
export async function createBusiness(formData: FormData): Promise<void> {
  const name = (formData.get("name") as string)?.trim();
  const domain = (formData.get("domain") as string)?.trim() || null;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const city = (formData.get("city") as string)?.trim() || null;
  const state = (formData.get("state") as string)?.trim() || null;

  if (!name) {
    redirect(`/records/new?error=${encodeURIComponent("A business name is required.")}`);
  }

  // Validate at the door, not after. Anything that fails here is rejected with a clear reason
  // rather than silently stored — which is also what makes it honest to mark every field that
  // DOES get stored as "verified" below: nothing unparseable ever reaches that point.
  if (domain && !normalizeDomain(domain)) {
    redirect(
      `/records/new?error=${encodeURIComponent(`"${domain}" doesn't look like a website address. Use the domain itself, e.g. "example.com" — not an email address.`)}`,
    );
  }
  if (phone && !normalizePhone(phone)) {
    redirect(
      `/records/new?error=${encodeURIComponent(`"${phone}" doesn't look like a valid US phone number. Try a format like (305) 757-6723.`)}`,
    );
  }

  const keys = buildIdentityKeys({
    name,
    domain,
    phone,
    location: city || state ? { city, state } : undefined,
  });

  const supabase = await createClient();

  // Check every constructed key against what already exists. If any collide, this is the same
  // business (or the operator has the wrong one) — send them to the existing record instead of
  // creating a duplicate. See packages/core/src/merge for the pipeline's fuller version of this
  // same judgment call, which additionally handles the "these might just look alike" case; a
  // human filling out a form can make that judgment themselves once shown the existing record.
  for (const key of keys) {
    const { data: existingKey } = await supabase
      .from("identity_keys")
      .select("business_id")
      .eq("key_type", key.keyType)
      .eq("key_value", key.keyValue)
      .maybeSingle();

    if (existingKey) {
      const { data: existingBusiness } = await supabase
        .from("businesses")
        .select("display_name")
        .eq("id", existingKey.business_id)
        .maybeSingle();
      const existingName = existingBusiness?.display_name ?? "an existing record";
      redirect(
        `/records/new?error=${encodeURIComponent(`${existingName} already has this ${key.keyType.replace("_", " ")} — open that record instead of creating a duplicate.`)}`,
      );
    }
  }

  const websiteStatus = domain ? "unclear" : "no_website"; // domain given but not yet crawled (Phase 3/4)

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .insert({
      display_name: name,
      name_normalized: normalizeName(name),
      website_status: websiteStatus,
      city,
      state,
      origin: "manual" as const,
    })
    .select("id")
    .single();

  if (businessError || !business) {
    redirect(`/records/new?error=${encodeURIComponent(businessError?.message ?? "Could not create the record.")}`);
  }

  if (keys.length > 0) {
    // Checked, because identity keys are what stops the same business being created twice by a
    // later import. Losing them silently produces a duplicate weeks later with no trace of why.
    const { error: keyError } = await supabase.from("identity_keys").insert(
      keys.map((k) => ({
        business_id: business.id,
        key_type: k.keyType,
        key_value: k.keyValue,
        rank: k.rank,
      })),
    );
    if (keyError) {
      redirect(
        `/records/${business.id}?error=${encodeURIComponent(
          `The business was created, but its matching keys were not saved (${keyError.message}). ` +
            `A later import of the same business could create it a second time.`,
        )}`,
      );
    }
  }

  // Manually entered fields are marked first-party and verified — a person confirmed them AND
  // the system's own normaliser confirmed the format, since anything that failed that check was
  // already rejected above (spec §1.2: never label unconfirmed data as verified). Only fields
  // the operator actually typed get a row; an empty field is left unrecorded, not stored as a
  // known-empty value.
  const fieldRows = [
    domain ? { field_name: "website_url", value: domain } : null,
    phone ? { field_name: "phone", value: phone } : null,
  ].filter((r): r is { field_name: string; value: string } => r !== null);

  if (fieldRows.length > 0) {
    const { error: fieldError } = await supabase.from("field_metadata").insert(
      fieldRows.map((r) => ({
        business_id: business.id,
        field_name: r.field_name,
        value: r.value,
        source_name: "manual_entry",
        verification_status: "verified" as const,
      })),
    );

    // The record exists either way, so this is a warning rather than a failure — but an operator who
    // typed a phone number and got a record without one deserves to know which of the two happened.
    if (fieldError) {
      redirect(
        `/records/${business.id}?error=${encodeURIComponent(
          `The business was created, but the website and phone you typed were not saved (${fieldError.message}).`,
        )}`,
      );
    }
  }

  redirect(`/records/${business.id}?saved=${encodeURIComponent("Business added.")}`);
}
