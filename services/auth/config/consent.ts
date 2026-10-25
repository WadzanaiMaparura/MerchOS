/**
 * Marketing-consent configuration (DRAFT — NOT legally reviewed).
 *
 * ⚠️ RELEASE BLOCKER: the consent copy, version identifier, and channel list
 * below are development placeholders. They MUST be reviewed and approved by a
 * qualified reviewer (legal/compliance) before any production release. Do not
 * treat this wording as approved.
 *
 * Consent is OPTIONAL and unchecked by default. Registering an account or
 * providing a phone number is NOT consent to promotional messaging. Only the
 * channels the user explicitly selects are persisted.
 */

import type { ConsentChannel } from '../../shared/types/registration.types';

/**
 * The version identifier persisted with each consent record. Bump this whenever
 * the consent copy changes so historical consents remain attributable to the
 * exact text the user saw.
 */
export const CONSENT_TEXT_VERSION = 'draft-2026-10-11';

/** Draft consent copy shown to the user (placeholder — pending approval). */
export const CONSENT_TEXT =
  'I would like to receive product updates and marketing communications from MerchOS. ' +
  'I understand I can withdraw this consent at any time.';

/** Channels a user may explicitly opt into. */
export const CONSENT_CHANNELS: readonly ConsentChannel[] = ['email', 'sms'] as const;
