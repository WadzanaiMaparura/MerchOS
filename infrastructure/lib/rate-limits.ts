/**
 * Turns on application-level rate limiting for API Lambdas.
 *
 * services/shared/middleware/rate-limit.ts counts requests per user per route in
 * the rate-limits table owned by the AuthApi stack. Without RATE_LIMITS_TABLE the
 * middleware only logs "rate limiting disabled" and lets everything through,
 * which is how the supplier, image and product-intelligence APIs ran until now.
 *
 * The table name is the fixed naming convention (like the products table in
 * other stacks) so no cross-stack reference / deploy-order coupling is added.
 */
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Stack } from 'aws-cdk-lib';

export function rateLimitsTableName(env: string): string {
  return `merch-os-rate-limits-${env}`;
}

export function enableRateLimiting(
  stack: Stack,
  env: string,
  platformKeyArn: string,
  fns: lambda.Function[],
): void {
  const tableArn = `arn:aws:dynamodb:${stack.region}:${stack.account}:table/${rateLimitsTableName(env)}`;
  for (const fn of fns) {
    fn.addEnvironment('RATE_LIMITS_TABLE', rateLimitsTableName(env));
    // The middleware only does an atomic ADD (UpdateItem) per request.
    fn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:UpdateItem'],
      resources: [tableArn],
    }));
    // The table is encrypted with the platform CMK.
    fn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey'],
      resources: [platformKeyArn],
    }));
  }
}
