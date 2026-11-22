/**
 * When a person is available to chat.
 *
 * Online only when ALL of these hold:
 *  1. Mon–Fri, 09:00–16:00 South African time (SAST, UTC+2, no daylight saving),
 *     and the day is not a public holiday;
 *  2. at least one agent has switched themselves Online;
 *  3. that agent's inbox has been seen (heartbeat) in the last 3 minutes, so a
 *     closed laptop cannot leave the chat looking staffed.
 *
 * Outside that, visitors see the "leave your details" form straight away.
 */

/** SAST is a fixed UTC+2 offset (South Africa does not observe daylight saving). */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export const OPENING_HOUR = 9;
export const CLOSING_HOUR = 16;
/** An agent counts as present if their inbox checked in this recently. */
export const HEARTBEAT_FRESH_MS = 3 * 60 * 1000;

export const HOURS_LABEL = 'Monday to Friday, 9am to 4pm (SAST), closed on public holidays';

/**
 * South African public holidays (Public Holidays Act 36 of 1994), including the
 * Monday observed when a holiday falls on a Sunday. Editable from the Support
 * inbox settings; this is only the starting list.
 */
export const DEFAULT_PUBLIC_HOLIDAYS: readonly string[] = [
  // 2026
  '2026-01-01', '2026-03-21', '2026-04-03', '2026-04-06', '2026-04-27',
  '2026-05-01', '2026-06-16', '2026-08-09', '2026-08-10', '2026-09-24',
  '2026-12-16', '2026-12-25', '2026-12-26',
  // 2027
  '2027-01-01', '2027-03-21', '2027-03-22', '2027-03-26', '2027-03-29',
  '2027-04-27', '2027-05-01', '2027-06-16', '2027-08-09', '2027-09-24',
  '2027-12-16', '2027-12-25', '2027-12-26', '2027-12-27',
];

export interface AgentPresence {
  agentId: string;
  /** The agent's own Online/Offline switch. */
  online: boolean;
  /** Epoch ms of the last inbox heartbeat. */
  lastSeenAt: number;
}

/** Wall-clock parts of an instant in SAST. */
export function sastParts(now: Date): { date: string; weekday: number; hour: number; minute: number } {
  const local = new Date(now.getTime() + SAST_OFFSET_MS);
  const date = local.toISOString().slice(0, 10);
  return {
    date,
    weekday: local.getUTCDay(), // 0 = Sunday
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

/** True inside Mon–Fri 09:00–16:00 SAST on a day that is not a public holiday. */
export function isWithinHours(now: Date, holidays: readonly string[]): boolean {
  const { date, weekday, hour } = sastParts(now);
  if (weekday === 0 || weekday === 6) return false;
  if (holidays.includes(date)) return false;
  return hour >= OPENING_HOUR && hour < CLOSING_HOUR;
}

/** Agents who are switched Online and whose inbox is still checking in. */
export function presentAgents(agents: readonly AgentPresence[], now: Date): AgentPresence[] {
  const cutoff = now.getTime() - HEARTBEAT_FRESH_MS;
  return agents.filter((a) => a.online && a.lastSeenAt >= cutoff);
}

/** The full online rule. */
export function isChatOnline(
  now: Date,
  holidays: readonly string[],
  agents: readonly AgentPresence[],
): boolean {
  return isWithinHours(now, holidays) && presentAgents(agents, now).length > 0;
}

/** YYYY-MM-DD validation for the editable holiday list. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
