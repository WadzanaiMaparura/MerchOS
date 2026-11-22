import { describe, expect, it } from 'vitest';
import type { CustomMessageTriggerEvent } from 'aws-lambda';
import { handler } from '../../triggers/custom-message';

function event(triggerSource: string): CustomMessageTriggerEvent {
  return {
    triggerSource,
    userName: 'user',
    request: { userAttributes: { email: 'seller@example.co.za' }, codeParameter: '{####}', usernameParameter: '{username}' },
    response: { smsMessage: null, emailMessage: null, emailSubject: null },
  } as unknown as CustomMessageTriggerEvent;
}

const CODE_SOURCES = [
  'CustomMessage_Authentication',
  'CustomMessage_SignUp',
  'CustomMessage_ResendCode',
  'CustomMessage_ForgotPassword',
  'CustomMessage_UpdateUserAttribute',
  'CustomMessage_VerifyUserAttribute',
  'CustomMessage_AdminCreateUser',
];

describe('branded Cognito emails', () => {
  it.each(CODE_SOURCES)('%s gets a branded email with the code placeholder exactly once', async (source) => {
    const out = await handler(event(source));
    const html = out.response.emailMessage ?? '';
    expect(out.response.emailSubject).toMatch(/MerchOS/);
    expect(html.split('{####}')).toHaveLength(2);
    expect(html).toContain('info@merchos.co.za');
    // Cognito rejects custom messages over 20,000 characters.
    expect(html.length).toBeLessThan(20_000);
    // We sell listings done by MerchOS, never "AI".
    expect(html).not.toMatch(/\bAI\b/);
  });

  it('upgrades the plain sign-in code email', async () => {
    const out = await handler(event('CustomMessage_Authentication'));
    expect(out.response.emailSubject).toBe('Your MerchOS sign-in code');
    expect(out.response.emailMessage).toContain('Your sign-in code');
    expect(out.response.emailMessage).toContain('(SAST)');
  });

  it('invitations include the username placeholder', async () => {
    const out = await handler(event('CustomMessage_AdminCreateUser'));
    expect(out.response.emailMessage).toContain('{username}');
  });

  it('leaves unknown sources to Cognito defaults', async () => {
    const out = await handler(event('CustomMessage_Something'));
    expect(out.response.emailMessage).toBeNull();
  });
});
