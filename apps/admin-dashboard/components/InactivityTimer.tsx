'use client';

/**
 * InactivityTimer — Mounts the inactivity timeout for admin sessions.
 *
 * Staff are signed out after a working day (8 hours) without activity. Both
 * Admin and Support can answer live chats, and a shorter idle sign-out would
 * silently take them offline (the inbox heartbeat stops). By decision (Nov
 * 2026) Admin gets the same 8 hours as Support. Sign-in still needs MFA, and
 * every staff action is in the Audit log.
 * Renders nothing to the DOM.
 *
 * Requirements: 1.9
 */

import { useAdminAuth } from '../hooks/useAdminAuth';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';

export const STAFF_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
/** @deprecated kept for older imports; Admin and Support share one timeout. */
export const ADMIN_IDLE_TIMEOUT_MS = STAFF_IDLE_TIMEOUT_MS;
/** @deprecated kept for older imports; Admin and Support share one timeout. */
export const SUPPORT_IDLE_TIMEOUT_MS = STAFF_IDLE_TIMEOUT_MS;

export function InactivityTimer() {
  const { logout } = useAdminAuth();

  useInactivityTimeout({ timeoutMs: STAFF_IDLE_TIMEOUT_MS, onTimeout: logout });

  return null;
}

export default InactivityTimer;
