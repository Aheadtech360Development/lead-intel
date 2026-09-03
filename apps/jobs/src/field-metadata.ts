import { fieldMetadata, type Database } from "@lead-intel/db";

export interface FieldUpdate {
  fieldName: string;
  value: string;
  sourceName: string;
}

/**
 * Writes the current value of one or more fields for a business, with provenance.
 *
 * `verification_status` is "verified" for everything written here, and that is a claim worth
 * being deliberate about: every caller is recording something the system itself measured — a
 * provider's own response, or our own crawl of the site — never something inferred or assumed.
 * The manual entry form holds itself to the same standard (it validates before it stores, see
 * apps/web/app/records/new/actions.ts). If a future caller ever wants to record a *guess* here,
 * it must pass a different status rather than inherit this one.
 *
 * Upsert rather than append: field_metadata holds the current value of a field, not a history of
 * it (schema.ts's unique index on business_id + field_name is what enforces that).
 */
export async function upsertFieldMetadata(
  db: Database,
  businessId: string,
  fields: FieldUpdate[],
): Promise<void> {
  if (fields.length === 0) return;
  const now = new Date();

  for (const field of fields) {
    await db
      .insert(fieldMetadata)
      .values({
        businessId,
        fieldName: field.fieldName,
        value: field.value,
        sourceName: field.sourceName,
        verificationStatus: "verified",
        lastVerifiedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [fieldMetadata.businessId, fieldMetadata.fieldName],
        set: {
          value: field.value,
          sourceName: field.sourceName,
          verificationStatus: "verified",
          lastVerifiedAt: now,
          updatedAt: now,
        },
      });
  }
}
