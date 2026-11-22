import { HOURS_LABEL, isChatOnline, isWithinHours } from './availability';
import { config } from './config';
import { getHolidays, listPresence } from './store';

export interface ChatAvailability {
  online: boolean;
  withinHours: boolean;
  agentName: string;
  hoursLabel: string;
}

export async function getAvailability(now: Date = new Date()): Promise<ChatAvailability> {
  const [holidays, presence] = await Promise.all([getHolidays(), listPresence()]);
  return {
    online: isChatOnline(now, holidays, presence),
    withinHours: isWithinHours(now, holidays),
    agentName: config.agentDisplayName,
    hoursLabel: HOURS_LABEL,
  };
}
