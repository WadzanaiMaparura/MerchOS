#!/usr/bin/env node
/**
 * CDK App entry point for the MerchOS platform.
 * Instantiates all CDK stacks with environment-specific configuration.
 */

import * as cdk from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack';

const app = new cdk.App();

const env = app.node.tryGetContext('env') as string ?? 'dev';

new FoundationStack(app, `MerchOS-Foundation-${env}`, {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'af-south-1',
  },
  environment: env,
});

app.synth();
