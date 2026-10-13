/**
 * International phone-number helpers for the profile-completion recovery form.
 *
 * SCOPE AND INTENT
 * ----------------
 * These helpers validate and normalise phone numbers to compact E.164 form
 * (e.g. "+27712345678") WITHOUT assuming a default country and WITHOUT a
 * third-party library. They deliberately validate only the E.164 SHAPE:
 *
 *   - a required leading '+' (the user must supply the country code);
 *   - 8 to 15 digits in total (E.164 permits at most 15 digits including the
 *     country code; the lower bound rejects obviously-too-short input);
 *   - only '+', digits, spaces, hyphens, parentheses and dots as input
 *     formatting characters.
 *
 * They do NOT verify that the country code or national-number length is valid
 * for a specific country — that requires a maintained metadata library such as
 * libphonenumber-js. Full per-country validation is intentionally out of scope
 * here (the deployed backend contract does not require it), and a hand-rolled
 * per-country parser would be fragile. See the PR notes for the follow-up to
 * adopt libphonenumber-js if stricter validation is later required.
 *
 * Normalisation only ever strips visual formatting from an already-valid
 * international number. It never invents, defaults, or rewrites a country code,
 * and it returns null for input it cannot safely normalise.
 */

/** Characters allowed as visual formatting in raw phone input. */
const ALLOWED_INPUT = /^[+()\-.\s0-9]+$/;

/** Minimum / maximum number of digits in a valid E.164 number. */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * Strip visual formatting (spaces, hyphens, parentheses, dots) while keeping a
 * single leading '+'. Returns the compact candidate (e.g. "+27712345678") or
 * null if the input contains disallowed characters or a misplaced '+'.
 */
function toCompact(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!ALLOWED_INPUT.test(trimmed)) return null;

  const hasLeadingPlus = trimmed.startsWith('+');
  // A '+' may only appear as the very first character. Any other '+' is invalid.
  const plusCount = (trimmed.match(/\+/g) ?? []).length;
  if (plusCount > 1) return null;
  if (plusCount === 1 && !hasLeadingPlus) return null;

  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;

  return hasLeadingPlus ? `+${digits}` : digits;
}

/**
 * True when `raw` is a valid international phone number by E.164 shape:
 * an explicit '+' country code followed by 8–15 total digits.
 *
 * Rejects: empty input, numbers without a leading '+', numbers with too few or
 * too many digits, and anything containing disallowed characters.
 */
export function isValidInternationalPhone(raw: string): boolean {
  const compact = toCompact(raw);
  if (!compact) return false;
  if (!compact.startsWith('+')) return false; // country code is mandatory
  const digits = compact.slice(1);
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return false;
  // A country code cannot start with 0.
  if (digits.startsWith('0')) return false;
  return true;
}

/**
 * Normalise a valid international number to compact E.164 ("+<digits>").
 * Returns null when the input is not a valid international number — callers
 * must treat null as "reject", never as "assume a country code".
 */
export function normalizeToE164(raw: string): string | null {
  if (!isValidInternationalPhone(raw)) return null;
  return toCompact(raw);
}
