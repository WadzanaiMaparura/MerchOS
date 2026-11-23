/**
 * Seller accounts in the shared Cognito user pool.
 *
 * Sellers (owners and their team) are in the "Seller" group once sign-up is
 * complete. People who started signing up but never entered the email code
 * are UNCONFIRMED and in no group yet. Staff (Admin/Support) are never listed.
 */

import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  ResendConfirmationCodeCommand,
  type AttributeType,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from './config';

let client: CognitoIdentityProviderClient | undefined;
export function cognito(): CognitoIdentityProviderClient {
  client ??= new CognitoIdentityProviderClient({});
  return client;
}

/** @internal tests only */
export function _setCognito(value: CognitoIdentityProviderClient | undefined): void {
  client = value;
}

export interface SellerUser {
  userId: string;
  email: string;
  emailVerified: boolean;
  /** Tenant from either custom attribute (self sign-up: tenantIdAssigned; invited: tenantId). */
  tenantId?: string | undefined;
  /** owner | admin | editor | viewer */
  role?: string | undefined;
  /** Cognito UserStatus: CONFIRMED, UNCONFIRMED, FORCE_CHANGE_PASSWORD, ... */
  status: string;
  enabled: boolean;
  createdAt: string;
}

const attr = (attrs: AttributeType[] | undefined, name: string) => attrs?.find((a) => a.Name === name)?.Value;

export function toSellerUser(u: UserType): SellerUser {
  const a = u.Attributes ?? [];
  return {
    userId: u.Username ?? '',
    email: attr(a, 'email') ?? '',
    emailVerified: attr(a, 'email_verified') === 'true',
    tenantId: attr(a, 'custom:tenantIdAssigned') || attr(a, 'custom:tenantId') || undefined,
    role: attr(a, 'custom:role') || undefined,
    status: u.UserStatus ?? 'UNKNOWN',
    enabled: u.Enabled !== false,
    createdAt: u.UserCreateDate?.toISOString() ?? '',
  };
}

async function listGroup(group: string): Promise<UserType[]> {
  const out: UserType[] = [];
  let token: string | undefined;
  for (let page = 0; page < 200; page++) {
    const res = await cognito().send(
      new ListUsersInGroupCommand({ UserPoolId: config.userPoolId, GroupName: group, Limit: 60, ...(token ? { NextToken: token } : {}) }),
    );
    out.push(...(res.Users ?? []));
    token = res.NextToken;
    if (!token) break;
  }
  return out;
}

/** Staff accounts (Admin or Support), by user id. */
export async function listStaffIds(): Promise<Set<string>> {
  const [admins, support] = await Promise.all([listGroup('Admin'), listGroup('Support')]);
  return new Set([...admins, ...support].map((u) => u.Username ?? ''));
}

/**
 * Every seller account (Seller group), all pages. Staff are never sellers here,
 * even if their account is also in the Seller group (e.g. used to test the
 * seller site): they are not customers and must never be disabled from Customers.
 */
export async function listSellerUsers(): Promise<SellerUser[]> {
  const [sellers, staff] = await Promise.all([listGroup('Seller'), listStaffIds()]);
  return sellers.filter((u) => !staff.has(u.Username ?? '')).map(toSellerUser);
}

/** People who started signing up but never entered the email code. */
export async function listUnfinishedSignUps(): Promise<SellerUser[]> {
  const out: SellerUser[] = [];
  let token: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await cognito().send(
      new ListUsersCommand({
        UserPoolId: config.userPoolId,
        Filter: 'cognito:user_status = "UNCONFIRMED"',
        Limit: 60,
        ...(token ? { PaginationToken: token } : {}),
      }),
    );
    out.push(...(res.Users ?? []).map(toSellerUser));
    token = res.PaginationToken;
    if (!token) break;
  }
  return out;
}

export async function getUser(userId: string): Promise<SellerUser | null> {
  try {
    const res = await cognito().send(new AdminGetUserCommand({ UserPoolId: config.userPoolId, Username: userId }));
    return toSellerUser({
      ...(res.Username ? { Username: res.Username } : {}),
      ...(res.UserAttributes ? { Attributes: res.UserAttributes } : {}),
      ...(res.UserStatus ? { UserStatus: res.UserStatus } : {}),
      ...(res.Enabled !== undefined ? { Enabled: res.Enabled } : {}),
      ...(res.UserCreateDate ? { UserCreateDate: res.UserCreateDate } : {}),
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'UserNotFoundException') return null;
    throw error;
  }
}

/** Blocks sign-in and ends every open session (tokens stop refreshing). */
export async function disableUser(userId: string): Promise<void> {
  await cognito().send(new AdminDisableUserCommand({ UserPoolId: config.userPoolId, Username: userId }));
  await cognito().send(new AdminUserGlobalSignOutCommand({ UserPoolId: config.userPoolId, Username: userId }));
}

export async function enableUser(userId: string): Promise<void> {
  await cognito().send(new AdminEnableUserCommand({ UserPoolId: config.userPoolId, Username: userId }));
}

/** Sends the sign-up verification code again (CustomMessage_ResendCode). */
export async function resendSignUpCode(userId: string): Promise<void> {
  await cognito().send(new ResendConfirmationCodeCommand({ ClientId: config.sellerClientId, Username: userId }));
}
