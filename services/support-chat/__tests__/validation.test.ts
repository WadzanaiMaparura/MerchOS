import { describe, expect, it } from 'vitest';
import { cleanText, leaveDetailsSchema, pushSubscriptionSchema, startChatSchema } from '../lib/validation';
import { atExpression } from '../lib/timers';

describe('chat input rules', () => {
  it('strips control characters and trims, keeping newlines', () => {
    expect(cleanText('  hi\u0000 there\u200B\nnext line  ')).toBe('hi there\nnext line');
  });

  it('requires a message of at most 2,000 characters', () => {
    expect(startChatSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(startChatSchema.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
    expect(startChatSchema.safeParse({ message: 'x'.repeat(2000) }).success).toBe(true);
  });

  it('treats a blank optional email as not given, and rejects a bad one', () => {
    const blank = startChatSchema.safeParse({ message: 'hi', email: '' });
    expect(blank.success && blank.data.email).toBeUndefined();
    expect(startChatSchema.safeParse({ message: 'hi', email: 'nope' }).success).toBe(false);
  });

  it('keeps only the path of the page', () => {
    const r = startChatSchema.parse({ message: 'hi', page: '/pricing?utm=x#top' });
    expect(r.page).toBe('/pricing');
    expect(startChatSchema.parse({ message: 'hi', page: 'https://evil.example/' }).page).toBeUndefined();
  });

  it('needs name, valid email and message to leave details', () => {
    expect(leaveDetailsSchema.safeParse({ name: 'Thandi', email: 'T@Example.co.za', message: 'Call me' }).success).toBe(true);
    expect(leaveDetailsSchema.parse({ name: 'Thandi', email: 'T@Example.co.za', message: 'x' }).email).toBe('t@example.co.za');
    expect(leaveDetailsSchema.safeParse({ name: '', email: 't@example.co.za', message: 'x' }).success).toBe(false);
    expect(leaveDetailsSchema.safeParse({ name: 'T', email: 'bad', message: 'x' }).success).toBe(false);
  });

  it('only accepts https push endpoints', () => {
    const keys = { p256dh: 'k', auth: 'a' };
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'https://push.example/1', keys }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint: 'http://push.example/1', keys }).success).toBe(false);
  });
});

describe('scheduler expression', () => {
  it('uses UTC wall time to the second', () => {
    expect(atExpression(new Date('2026-11-23T08:01:02.345Z'))).toBe('at(2026-11-23T08:01:02)');
  });
});
