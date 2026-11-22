'use client';

/**
 * InactivityTimer — Mounts the inactivity timeout for admin sessions.
 *
 * Admins are signed out after 30 minutes without activity. Support staff wait
 * on the live-chat inbox for chats to arrive, and a 30-minute idle sign-out
 * would silently take them offline (the inbox heartbeat stops), so the
 * Support role gets a working day (8 hours). Support can only reach the
 * Support inbox, which limits what an unattended session exposes.
 * Renders nothing to the DOM.
 *
 * Requirements: 1.9
 */

import { useAdminAuth } from '../hooks/useAdminAuth';
import { useInactivityTimeout } from '../hooks/useInactivityTimeout';
import { usePlatformRole } from '../hooks/usePlatformRole';

export const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SUPPORT_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export function InactivityTimer() {
  const { logout } = useAdminAuth();
  const { platformRole } = usePlatformRole();

  useInactivityTimeout({
    timeoutMs: platformRole === 'Support' ? SUPPORT_IDLE_TIMEOUT_MS : ADMIN_IDLE_TIMEOUT_MS,
    onTimeout: logout,
  });

  return null;
}

export default InactivityTimer;
