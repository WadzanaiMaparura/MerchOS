import { describe, expect, it, beforeEach } from 'vitest';
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { _setCognito, listSellerUsers } from '../lib/cognito';

const user = (id: string, email: string) => ({
  Username: id,
  UserStatus: 'CONFIRMED',
  Enabled: true,
  Attributes: [
    { Name: 'email', Value: email },
    { Name: 'custom:tenantIdAssigned', Value: `tenant-${id}` },
  ],
});

const groups: Record<string, ReturnType<typeof user>[]> = {
  Seller: [user('seller-1', 'thandi@example.co.za'), user('staff-1', 'admin@merchos.co.za')],
  Admin: [user('staff-1', 'admin@merchos.co.za')],
  Support: [user('staff-2', 'info@merchos.co.za')],
};

beforeEach(() => {
  process.env['USER_POOL_ID'] = 'eu-west-1_test';
  _setCognito({
    send: async (cmd: { input: { GroupName: string } }) => ({ Users: groups[cmd.input.GroupName] ?? [] }),
  } as unknown as CognitoIdentityProviderClient);
});

describe('seller accounts', () => {
  it('a staff account that is also in the Seller group is not a customer', async () => {
    const sellers = await listSellerUsers();
    expect(sellers.map((s) => s.email)).toEqual(['thandi@example.co.za']);
  });
});
