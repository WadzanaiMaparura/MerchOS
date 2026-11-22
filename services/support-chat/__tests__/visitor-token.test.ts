import { describe, expect, it } from 'vitest';
import { issueVisitorToken, verifyVisitorToken, VISITOR_TOKEN_TTL_SECONDS } from '../lib/visitor-token';

const SECRET = 'test-secret-value-that-is-long-enough';
const ID = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('visitor tokens', () => {
  it('round-trips to the conversation it was issued for', () => {
    expect(verifyVisitorToken(issueVisitorToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it('rejects a token signed with another secret', () => {
    expect(verifyVisitorToken(issueVisitorToken(ID, 'other-secret'), SECRET)).toBeNull();
  });

  it('rejects a token pointed at a different conversation', () => {
    const [, exp, sig] = issueVisitorToken(ID, SECRET).split('.');
    const forged = `4f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b.${exp}.${sig}`;
    expect(verifyVisitorToken(forged, SECRET)).toBeNull();
  });

  it('rejects an extended expiry', () => {
    const [id, exp, sig] = issueVisitorToken(ID, SECRET).split('.');
    expect(verifyVisitorToken(`${id}.${Number(exp) + 9999}.${sig}`, SECRET)).toBeNull();
  });

  it('expires after its lifetime', () => {
    const issuedAt = Date.now();
    const token = issueVisitorToken(ID, SECRET, issuedAt);
    expect(verifyVisitorToken(token, SECRET, issuedAt + (VISITOR_TOKEN_TTL_SECONDS - 1) * 1000)).toBe(ID);
    expect(verifyVisitorToken(token, SECRET, issuedAt + (VISITOR_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it('rejects junk', () => {
    for (const bad of [undefined, null, '', 'a.b', 'a.b.c', `${ID}.x.y`, 'x'.repeat(500)]) {
      expect(verifyVisitorToken(bad as string, SECRET)).toBeNull();
    }
  });
});
