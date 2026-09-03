import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface NormalizedPhone {
  e164: string;
  country: CountryCode | undefined;
  /**
   * "unknown" covers two genuinely different situations, deliberately not distinguished further:
   * the type genuinely couldn't be determined, AND the North American Numbering Plan case where
   * libphonenumber-js reports "FIXED_LINE_OR_MOBILE" because the numbering plan itself does not
   * encode line type. Almost every business phone this system sees will be a US number, so that
   * second case is the common one — reporting it as "landline" would be a confident-sounding
   * claim the source data cannot actually support. Better to say "unknown" honestly than to
   * guess, per the project's own rule that unconfirmed data is never displayed as verified.
   */
  lineType: "mobile" | "landline" | "voip" | "unknown";
}

/**
 * Normalises a raw phone number to E.164. `defaultCountry` is used only when the input has no
 * country code of its own — pass the country the search was run in, never assume "US" silently.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "US",
): NormalizedPhone | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;

  const type = parsed.getType();
  const lineType: NormalizedPhone["lineType"] =
    type === "MOBILE" ? "mobile" : type === "FIXED_LINE" ? "landline" : type === "VOIP" ? "voip" : "unknown";

  return {
    e164: parsed.number,
    country: parsed.country,
    lineType,
  };
}

export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined,
  defaultCountry: CountryCode = "US",
): boolean {
  const na = normalizePhone(a, defaultCountry);
  const nb = normalizePhone(b, defaultCountry);
  return na !== null && nb !== null && na.e164 === nb.e164;
}
