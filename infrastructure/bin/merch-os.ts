#!/usr/bin/env node
/**
 * CDK App entry point for the MerchOS platform.
 * Instantiates all CDK stacks with environment-specific configuration.
 */

import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';
import { AuthStack } from '../lib/auth-stack';
import { AuthApiStack } from '../lib/auth-api-stack';
import { ProductApiStack } from '../lib/product-api-stack';
import { SupplierIntelligenceStack } from '../lib/supplier-intelligence-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') as string ?? 'dev';

const cdkEnv: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT']!,
  region: process.env['CDK_DEFAULT_REGION'] ?? 'af-south-1',
};

const foundationStack = new FoundationStack(app, `MerchOS-Foundation-${env}`, {
  env: cdkEnv,
  environment: env,
});

const authStack = new AuthStack(app, `MerchOS-Auth-${env}`, {
  env: cdkEnv,
  environment: env,
  platformKey: foundationStack.platformKey,
  eventBus: foundationStack.eventBus,
});

new AuthApiStack(app, `MerchOS-AuthApi-${env}`, {
  env: cdkEnv,
  environment: env,
  userPool: authStack.userPool,
  sellerDashboardClient: authStack.sellerDashboardClient,
  platformKey: foundationStack.platformKey,
  eventBus: foundationStack.eventBus,
  invitationsTable: authStack.invitationsTable,
  sessionsTable: authStack.sessionsTable,
});

new ProductApiStack(app, `MerchOS-ProductApi-${env}`, {
  env: cdkEnv,
  environment: env,
  userPool: authStack.userPool,
  sellerDashboardClient: authStack.sellerDashboardClient,
  platformKey: foundationStack.platformKey,
  eventBus: foundationStack.eventBus,
});

new SupplierIntelligenceStack(app, `MerchOS-SupplierIntelligence-${env}`, {
  env: cdkEnv,
  environment: env,
});

app.synth();
