'use client';

/**
 * InactivityTimer — Mounts the 30-minute inactivity timeout for admin sessions.
 *
 * Calls useInactivityTimeout with 1,800,000ms (30 minutes) and triggers
 * logout when the threshold is exceeded. Renders nothing to the DOM.
 *
 * Requirements: 1.9
 */

import { useAdminAuth } from '../hooks/useAdminAuth';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';

export function InactivityTimer() {
  const { logout } = useAdminAuth();

  useInactivityTimeout({
    timeoutMs: 1_800_000, // 30 minutes
    onTimeout: logout,
  });

  return null;
}

export default InactivityTimer;
