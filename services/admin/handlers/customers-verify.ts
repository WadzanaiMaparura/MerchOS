/**
 * Resend the sign-up verification email. RBAC `users.verification` create
 * (Admin and Support).
 *
 *   POST /admin/customers/resend-verification   { userId }
 *
 * Only for people who started signing up and never entered the code
 * (Cognito UNCONFIRMED). Once they enter it, sign-up completes as normal.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { recordAudit } from '../lib/audit';
import { getUser, resendSignUpCode } from '../lib/cognito';
import { badRequest, conflict, json, notFound, readJson, serverError, staffOf, type HttpResult } from '../lib/http';

const bodySchema = z.object({ userId: z.string().min(1).max(128).regex(/^[A-Za-z0-9-]+$/) });

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    if (event.routeKey !== 'POST /admin/customers/resend-verification') return notFound();
    const staff = staffOf(event);
    const parsed = bodySchema.safeParse(readJson(event));
    if (!parsed.success) return badRequest('userId is required');
    const user = await getUser(parsed.data.userId);
    if (!user) return notFound('Account not found');
    if (user.status !== 'UNCONFIRMED') return conflict('This email is already verified.');
    if (!user.enabled) return conflict('This account is disabled. Enable it first.');
    await resendSignUpCode(user.userId);
    await recordAudit(
      user.tenantId ? { tenantId: user.tenantId } : { userId: user.userId },
      { action: 'resend-verification', by: staff.userId, byRole: staff.role },
    );
    return json(200, { sent: true });
  } catch (err) {
    console.error('Resend verification failed', { error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'users.verification', action: 'create' }));
