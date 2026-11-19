/**
 * normalizeError must surface the MerchOS error envelope ({ error: { code, message } })
 * so the dashboard can show our message and branch on the code (e.g. TRIAL_LIMIT_REACHED)
 * instead of Axios's generic "Request failed with status code 4xx".
 */
import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { normalizeError } from '@merch-os/api-client';

function axiosError(status: number, data: unknown, headers: Record<string, string> = {}) {
  const err = new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST');
  err.response = { status, statusText: '', data, headers, config: { headers: new AxiosHeaders() } } as never;
  return err;
}

describe('normalizeError', () => {
  it('reads code, message and field from the nested MerchOS envelope', () => {
    const e = normalizeError(axiosError(400, { error: { code: 'VALIDATION_ERROR', message: 'Enter a valid VAT number', field: 'vatNumber' } }));
    expect(e).toEqual({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Enter a valid VAT number', field: 'vatNumber', requestId: '' });
  });

  it('surfaces a 402 trial error so the UI can show an upgrade prompt', () => {
    const e = normalizeError(axiosError(402, { error: { code: 'TRIAL_LIMIT_REACHED', message: 'Your free trial is used up.' } }));
    expect(e.statusCode).toBe(402);
    expect(e.code).toBe('TRIAL_LIMIT_REACHED');
    expect(e.message).toBe('Your free trial is used up.');
  });

  it('still supports the old flat shape', () => {
    const e = normalizeError(axiosError(409, { code: 'CONFLICT', message: 'Already exists', requestId: 'r-1' }));
    expect(e).toMatchObject({ code: 'CONFLICT', message: 'Already exists', requestId: 'r-1' });
  });

  it('falls back to the Axios message and code when the body has neither', () => {
    const e = normalizeError(axiosError(502, '<html>Bad gateway</html>'));
    expect(e.message).toBe('Request failed with status code 502');
    expect(e.code).toBe('ERR_BAD_REQUEST');
    expect(e).not.toHaveProperty('field');
  });

  it('ignores non-string and empty values instead of showing "[object Object]" or blank', () => {
    const e = normalizeError(axiosError(400, { error: { code: 42, message: '' } }));
    expect(e.message).toBe('Request failed with status code 400');
    expect(e.code).toBe('ERR_BAD_REQUEST');
  });

  it('a null "error" key does not crash', () => {
    expect(normalizeError(axiosError(500, { error: null, message: 'boom' })).message).toBe('boom');
  });

  it('takes the request id from the response header', () => {
    expect(normalizeError(axiosError(500, {}, { 'x-request-id': 'abc' })).requestId).toBe('abc');
  });

  it('passes an already-normalised error through unchanged', () => {
    const already = { statusCode: 401, message: 'x', requestId: 'r', code: 'UNAUTHORIZED' };
    expect(normalizeError(already)).toBe(already);
  });

  it('handles plain and unknown errors', () => {
    expect(normalizeError(new Error('net down'))).toEqual({ statusCode: 0, message: 'net down', requestId: '', code: 'UNKNOWN_ERROR' });
    expect(normalizeError('weird')).toMatchObject({ statusCode: 0, code: 'UNKNOWN_ERROR' });
  });
});
