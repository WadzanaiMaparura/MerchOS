/**
 * Opens and closes alerts. Two triggers:
 *
 *   EventBridge schedule, every 15 minutes   health check of every area over the last 30 minutes:
 *                                            opens an alert when an area is failing (lib/health
 *                                            needsAlert), closes it after 30 quiet minutes
 *   CloudWatch Alarm State Change            existing alarms (payments, imports): ALARM opens,
 *                                            OK closes
 *
 * An email goes to the alert address when an alert opens and when it clears.
 */

import { openAlert, resolveByKey, type Alert } from '../lib/alerts';
import { alarmWording } from '../lib/alarm-catalogue';
import { AREAS, needsAlert, quickCheck, type AreaCheck } from '../lib/health';
import { sendAlertEmail } from '../lib/notify';

const env = () => process.env['ENVIRONMENT'] || 'dev';
const WINDOW_MINUTES = 30;

async function emailSafely(alert: Alert, kind: 'opened' | 'resolved'): Promise<void> {
  try {
    await sendAlertEmail(alert, kind);
  } catch (error) {
    console.error('Alert email not sent', { alertId: alert.alertId, kind, error: (error as Error).message });
  }
}

const pct = (c: AreaCheck) => (c.requests > 0 ? ` (${Math.round((c.errors / c.requests) * 100)}% of requests)` : '');

export async function runHealthCheck(now: Date = new Date()): Promise<{ opened: string[]; resolved: string[] }> {
  const checks = await quickCheck(env(), WINDOW_MINUTES, now);
  const opened: string[] = [];
  const resolved: string[] = [];
  for (const c of checks) {
    const area = AREAS.find((a) => a.id === c.id)!;
    const key = `area:${c.id}`;
    if (needsAlert(c)) {
      const { alert, created } = await openAlert(
        {
          key,
          source: 'area',
          area: c.id,
          title: `${area.label} is failing for some sellers`,
          description: `${c.errors} errors in the last ${WINDOW_MINUTES} minutes${pct(c)}.`,
          whatToDo: area.whatToDo,
        },
        now,
      );
      if (created) {
        opened.push(c.id);
        await emailSafely(alert, 'opened');
      }
    } else if (c.errors === 0) {
      const done = await resolveByKey(key, now);
      if (done) {
        resolved.push(c.id);
        await emailSafely(done, 'resolved');
      }
    }
    // A few errors below the threshold: leave any open alert as it is.
  }
  return { opened, resolved };
}

interface AlarmEvent {
  'detail-type': string;
  detail: { alarmName: string; state: { value: string; reason?: string }; configuration?: { description?: string } };
}

export async function onAlarm(event: AlarmEvent, now: Date = new Date()): Promise<'opened' | 'resolved' | 'ignored'> {
  const { alarmName, state, configuration } = event.detail;
  if (!alarmName.startsWith('merch-os-') || !alarmName.endsWith(`-${env()}`)) return 'ignored';
  const key = `alarm:${alarmName}`;
  if (state.value === 'ALARM') {
    const w = alarmWording(alarmName, env(), configuration?.description);
    const { alert, created } = await openAlert(
      { key, source: 'alarm', area: w.area, title: w.title, description: w.description, whatToDo: w.whatToDo },
      now,
    );
    if (created) await emailSafely(alert, 'opened');
    return 'opened';
  }
  if (state.value === 'OK') {
    const done = await resolveByKey(key, now);
    if (done) await emailSafely(done, 'resolved');
    return done ? 'resolved' : 'ignored';
  }
  return 'ignored'; // INSUFFICIENT_DATA: no change
}

export async function handler(event: { 'detail-type'?: string; detail?: unknown }): Promise<unknown> {
  if (event['detail-type'] === 'CloudWatch Alarm State Change') {
    const result = await onAlarm(event as AlarmEvent);
    console.info('Alarm state change', { alarm: (event as AlarmEvent).detail.alarmName, result });
    return { result };
  }
  const result = await runHealthCheck();
  console.info('Health check', result);
  return result;
}
