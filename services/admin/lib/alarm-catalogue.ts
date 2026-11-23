/**
 * Plain-language wording for the existing CloudWatch alarms (billing and
 * supplier imports). Matched on the alarm name without the "-<env>" suffix.
 * Unknown alarms fall back to their own description.
 */

import { areaDef, type AreaId } from './health';

export interface AlarmWording {
  area: AreaId;
  title: string;
  description: string;
  whatToDo?: string;
}

const CATALOGUE: Record<string, AlarmWording> = {
  'merch-os-billing-ItnErrors': {
    area: 'payments',
    title: 'Payment notifications are failing',
    description: 'The service that applies PayFast payments crashed. PayFast retries, but a paying seller may not be activated yet.',
  },
  'merch-os-billing-ItnRetrying': {
    area: 'payments',
    title: 'Could not check a PayFast payment',
    description: 'PayFast could not be reached to confirm a payment, so PayFast was asked to send it again.',
  },
  'merch-os-billing-ItnRejected': {
    area: 'payments',
    title: 'A payment notification was rejected',
    description: 'A payment notification failed the PayFast security checks. If it really came from PayFast, a payment was not applied.',
  },
  'merch-os-billing-ItnAnomaly': {
    area: 'payments',
    title: 'A payment did not match our records',
    description: 'A verified payment had the wrong amount, or no matching checkout. Possible tampering or a bug; the payment was not applied.',
  },
  'merch-os-billing-CheckoutErrors': {
    area: 'payments',
    title: 'Sellers cannot start a checkout',
    description: 'Starting a PayFast checkout failed, so sellers trying to subscribe see an error.',
  },
  'merch-os-billing-InvoiceIssueFailed': {
    area: 'payments',
    title: 'An invoice PDF could not be made',
    description: 'A paid invoice has no PDF yet. The payment is fine; the seller gets the PDF when they download it again.',
    whatToDo: 'No action needed unless a seller says their invoice will not download. Tell the team if it keeps happening.',
  },
  'merch-os-si-import-job-failure-rate': {
    area: 'imports',
    title: 'Many supplier imports are failing',
    description: 'More than 1 in 10 supplier imports failed in 5 minutes.',
  },
  'merch-os-si-import-queue-depth': {
    area: 'imports',
    title: 'Supplier imports are backed up',
    description: 'More than 100 import jobs are waiting. Sellers will wait longer for their files to appear.',
  },
  'merch-os-si-lambda-error-rate': {
    area: 'imports',
    title: 'Supplier import errors',
    description: 'More than 5% of supplier import steps failed in 5 minutes.',
  },
  'merch-os-si-import-dlq-depth': {
    area: 'imports',
    title: 'A supplier import gave up',
    description: 'An import job failed every retry and was set aside. That seller\'s file did not import.',
  },
};

export function alarmWording(alarmName: string, env: string, description?: string): AlarmWording & { whatToDo: string } {
  const base = alarmName.endsWith(`-${env}`) ? alarmName.slice(0, -env.length - 1) : alarmName;
  const known = CATALOGUE[base];
  if (known) return { ...known, whatToDo: known.whatToDo ?? areaDef(known.area).whatToDo };
  return {
    area: 'staff',
    title: base.replace(/^merch-os-/, '').replace(/-/g, ' '),
    description: description || 'An automatic check went off.',
    whatToDo: 'Tell the team; this check has no plain-language guide yet.',
  };
}
