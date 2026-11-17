import { describe, it, expect } from 'vitest';
import { safeNextPath, buildLoginUrl, readNextFromSearch } from '../return-to';

describe('safeNextPath', () => {
  it.each([
    ['/billing', '/billing'],
    ['/billing?checkout=success', '/billing?checkout=success'],
    ['/products/123?tab=images#top', '/products/123?tab=images#top'],
    ['/dashboard', '/dashboard'],
  ])('accepts %s', (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['billing'],
    ['https://evil.example/billing'],
    ['http://evil.example'],
    ['javascript:alert(1)'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['/billing\nSet-Cookie: x=1'],
    ['/bill ing'],
    ['/login'],
    ['/login/mfa'],
    ['/register'],
    ['/verify?x=1'],
    ['/reset-password'],
    ['/' + 'a'.repeat(2100)],
  ])('rejects %j', (input) => {
    expect(safeNextPath(input as string | null | undefined)).toBeNull();
  });

  it('does not treat a lookalike prefix as an auth page', () => {
    expect(safeNextPath('/login-help')).toBe('/login-help');
    expect(safeNextPath('/registered-users')).toBe('/registered-users');
  });
});

describe('buildLoginUrl', () => {
  it('appends an encoded next for a safe destination', () => {
    expect(buildLoginUrl('/login', '/billing?checkout=success')).toBe(
      '/login?next=%2Fbilling%3Fcheckout%3Dsuccess',
    );
  });
  it('omits next for the site root', () => {
    expect(buildLoginUrl('/login', '/')).toBe('/login');
  });
  it('returns the bare login path for unsafe or auth destinations', () => {
    expect(buildLoginUrl('/login', '/login')).toBe('/login');
    expect(buildLoginUrl('/login', '//evil.example')).toBe('/login');
  });
});

describe('readNextFromSearch', () => {
  it('round-trips with buildLoginUrl', () => {
    const url = buildLoginUrl('/login', '/billing?checkout=success');
    expect(readNextFromSearch(url.slice(url.indexOf('?')))).toBe('/billing?checkout=success');
  });
  it('returns null when absent or unsafe', () => {
    expect(readNextFromSearch('')).toBeNull();
    expect(readNextFromSearch('?next=https%3A%2F%2Fevil.example')).toBeNull();
  });
});
