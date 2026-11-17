import { describe, it, expect, vi } from 'vitest';
import {
  createLiveItnChecks,
  normaliseIp,
  stripSignature,
  PAYFAST_ITN_HOSTS,
} from '../payfast-itn-checks';
import { PayFastProvider, computeSignature, payfastUrlEncode } from '../payfast';

const resolve4 = vi.fn(async (host: string) =>
  host === 'www.payfast.co.za' ? ['41.74.179.194'] : host === 'sandbox.payfast.co.za' ? ['41.74.179.200'] : [],
);

function checks(overrides: Partial<Parameters<typeof createLiveItnChecks>[0]> = {}) {
  return createLiveItnChecks({ mode: 'sandbox', resolve4, ...overrides });
}

describe('helpers', () => {
  it('normalises IPv4-mapped IPv6 addresses', () => {
    expect(normaliseIp('::ffff:41.74.179.194')).toBe('41.74.179.194');
    expect(normaliseIp(' 1.2.3.4 ')).toBe('1.2.3.4');
  });
  it('removes only the signature field, keeping the rest byte-for-byte', () => {
    expect(stripSignature('a=1&item_name=Growth+Plan&signature=abc&z=%20')).toBe(
      'a=1&item_name=Growth+Plan&z=%20',
    );
  });
});

describe('checkSourceIp', () => {
  it('accepts an address one of PayFast hosts resolves to', async () => {
    expect(await checks().checkSourceIp('41.74.179.200')).toEqual({ ok: true });
  });
  it('accepts IPv4-mapped IPv6 form', async () => {
    expect(await checks().checkSourceIp('::ffff:41.74.179.194')).toEqual({ ok: true });
  });
  it('rejects an unknown address (final)', async () => {
    expect(await checks().checkSourceIp('6.6.6.6')).toMatchObject({
      ok: false,
      kind: 'rejected',
      reason: 'source_ip_not_allowed',
    });
  });
  it('rejects a missing source IP', async () => {
    expect(await checks().checkSourceIp(undefined)).toMatchObject({ ok: false, kind: 'rejected' });
  });
  it('reports unavailable (retryable) when no host resolves', async () => {
    const c = checks({ resolve4: async () => { throw new Error('ENOTFOUND'); } });
    expect(await c.checkSourceIp('41.74.179.194')).toMatchObject({ ok: false, kind: 'unavailable' });
  });
  it('tolerates some hosts failing to resolve', async () => {
    const c = checks({
      resolve4: async (h) => {
        if (h !== 'www.payfast.co.za') throw new Error('ENOTFOUND');
        return ['41.74.179.194'];
      },
    });
    expect(await c.checkSourceIp('41.74.179.194')).toEqual({ ok: true });
  });
  it('caches resolution until the TTL expires', async () => {
    const spy = vi.fn(async () => ['41.74.179.194']);
    let t = 0;
    const c = checks({ resolve4: spy, now: () => t });
    await c.checkSourceIp('41.74.179.194');
    await c.checkSourceIp('41.74.179.194');
    expect(spy).toHaveBeenCalledTimes(PAYFAST_ITN_HOSTS.length);
    t = 11 * 60 * 1000;
    await c.checkSourceIp('41.74.179.194');
    expect(spy).toHaveBeenCalledTimes(PAYFAST_ITN_HOSTS.length * 2);
  });
});

describe('postbackValidate', () => {
  const okResponse = (text: string, status = 200) =>
    ({ ok: status < 400, status, text: async () => text }) as unknown as Response;

  it('POSTs the body without the signature to the sandbox validate URL and accepts VALID', async () => {
    const fetchImpl = vi.fn(async () => okResponse('VALID'));
    const r = await checks({ fetchImpl: fetchImpl as never }).postbackValidate('a=1&signature=zzz&b=2');
    expect(r).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sandbox.payfast.co.za/eng/query/validate');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('a=1&b=2');
  });
  it('uses the live URL in live mode', async () => {
    const fetchImpl = vi.fn(async () => okResponse('VALID'));
    await checks({ mode: 'live', fetchImpl: fetchImpl as never }).postbackValidate('a=1');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://www.payfast.co.za/eng/query/validate');
  });
  it('rejects INVALID (final)', async () => {
    const r = await checks({ fetchImpl: (async () => okResponse('INVALID')) as never }).postbackValidate('a=1');
    expect(r).toMatchObject({ ok: false, kind: 'rejected', reason: 'postback_invalid' });
  });
  it('treats network failure as unavailable (retryable)', async () => {
    const r = await checks({ fetchImpl: (async () => { throw new Error('boom'); }) as never }).postbackValidate('a=1');
    expect(r).toMatchObject({ ok: false, kind: 'unavailable', reason: 'postback_unreachable' });
  });
  it('treats a 5xx from PayFast as unavailable (retryable)', async () => {
    const r = await checks({ fetchImpl: (async () => okResponse('', 503)) as never }).postbackValidate('a=1');
    expect(r).toMatchObject({ ok: false, kind: 'unavailable', reason: 'postback_http_503' });
  });
});

describe('PayFastProvider.verifyItn with network checks', () => {
  const CONFIG = { merchantId: '1', merchantKey: 'k', passphrase: 'p', mode: 'sandbox' as const, notifyUrl: 'https://x/y' };
  const fields: Array<[string, string]> = [
    ['m_payment_id', 'pay-1'],
    ['payment_status', 'COMPLETE'],
    ['amount_gross', '999.00'],
    ['custom_str1', 'tenant-1'],
  ];
  const body =
    fields.map(([k, v]) => `${k}=${payfastUrlEncode(v)}`).join('&') +
    `&signature=${computeSignature(fields, CONFIG.passphrase)}`;

  const ok = { ok: true } as const;

  it('runs both checks after a valid signature and accepts', async () => {
    const itn = { checkSourceIp: vi.fn(async () => ok), postbackValidate: vi.fn(async () => ok) };
    const r = await new PayFastProvider(CONFIG, itn).verifyItn(body, {}, '41.74.179.194');
    expect(r.valid).toBe(true);
    expect(itn.checkSourceIp).toHaveBeenCalledWith('41.74.179.194');
    expect(itn.postbackValidate).toHaveBeenCalledWith(body);
  });
  it('does not touch the network when the signature is bad', async () => {
    const itn = { checkSourceIp: vi.fn(async () => ok), postbackValidate: vi.fn(async () => ok) };
    const r = await new PayFastProvider(CONFIG, itn).verifyItn(body.replace('999.00', '1.00'), {}, '1.1.1.1');
    expect(r).toMatchObject({ valid: false, reason: 'signature_mismatch' });
    expect(itn.checkSourceIp).not.toHaveBeenCalled();
    expect(itn.postbackValidate).not.toHaveBeenCalled();
  });
  it('rejects (not retryable) on a disallowed source IP and skips the postback', async () => {
    const itn = {
      checkSourceIp: vi.fn(async () => ({ ok: false, kind: 'rejected', reason: 'source_ip_not_allowed' }) as const),
      postbackValidate: vi.fn(async () => ok),
    };
    const r = await new PayFastProvider(CONFIG, itn).verifyItn(body, {}, '6.6.6.6');
    expect(r).toMatchObject({ valid: false, reason: 'source_ip_not_allowed' });
    expect(r.retryable).toBeUndefined();
    expect(itn.postbackValidate).not.toHaveBeenCalled();
  });
  it('marks an unavailable postback as retryable', async () => {
    const itn = {
      checkSourceIp: vi.fn(async () => ok),
      postbackValidate: vi.fn(async () => ({ ok: false, kind: 'unavailable', reason: 'postback_unreachable' }) as const),
    };
    const r = await new PayFastProvider(CONFIG, itn).verifyItn(body, {}, '41.74.179.194');
    expect(r).toMatchObject({ valid: false, retryable: true, reason: 'postback_unreachable' });
  });
});
