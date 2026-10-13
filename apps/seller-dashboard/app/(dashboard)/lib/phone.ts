/**
 * International phone-number helpers for the profile-completion recovery form.
 *
 * Backed by `libphonenumber-js` (Google's libphonenumber metadata) for real
 * per-country validation and E.164 normalisation — no hand-rolled parsing.
 *
 * Rules enforced here:
 *   - The caller MUST supply an explicit country calling code via a leading
 *     '+'. We never infer or default a country, so an ambiguous national number
 *     can never be silently promoted to a specific country.
 *   - Validity is decided by the library's `isValid()` (full metadata check),
 *     not merely digit counts or `isPossible()`.
 *   - Valid numbers are normalised to compact E.164 via the library formatter.
 *   - Invalid / incomplete / malformed / unparseable input is rejected; it is
 *     never repaired or rewritten into a valid-looking number.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Parse a raw user string into a validated libphonenumber-js number, or null.
 *
 * Requires an explicit leading '+'. We pass NO default country, so a number
 * without a country calling code is treated as unparseable/invalid rather than
 * being assigned a country.
 */
/**
 * Only '+', digits and visual grouping characters are permitted in raw input.
 * This rejects letters and extension syntax (e.g. "ext 99") up front, so a
 * valid base number with trailing junk can never be silently normalised into a
 * number that drops the user's extra input.
 */
const ALLOWED_INPUT = /^[+()\-.\s0-9]+$/;

function parseValid(raw: string) {
  const trimmed = raw.trim();
  // Mandatory explicit international prefix. Without it we refuse to guess.
  if (!trimmed.startsWith('+')) return null;
  // Reject letters / extensions / other junk before parsing so nothing is
  // silently stripped during normalisation.
  if (!ALLOWED_INPUT.test(trimmed)) return null;

  let parsed;
  try {
    parsed = parsePhoneNumberFromString(trimmed);
  } catch {
    // Defensive: parsePhoneNumberFromString returns undefined rather than
    // throwing for bad input, but guard anyway so callers always get null.
    return null;
  }

  if (!parsed) return null;
  if (!parsed.isValid()) return null;
  return parsed;
}

/**
 * True when `raw` is a valid international phone number (explicit '+' country
 * code + a number the libphonenumber metadata accepts for that country).
 */
export function isValidInternationalPhone(raw: string): boolean {
  return parseValid(raw) !== null;
}

/**
 * Normalise a valid international number to compact E.164 ("+<digits>").
 * Returns null when the input is not a valid international number — callers
 * must treat null as "reject", never as "assume a country code".
 */
export function normalizeToE164(raw: string): string | null {
  const parsed = parseValid(raw);
  if (!parsed) return null;
  return parsed.number; // E.164 form, e.g. "+27712345678"
}
