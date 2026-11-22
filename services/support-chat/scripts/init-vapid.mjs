#!/usr/bin/env node
/**
 * Adds a Web Push (VAPID) key pair to the chat secret, once.
 *
 * Usage (from services/support-chat, with AWS SSO logged in):
 *   $env:AWS_PROFILE='merchos-admin'; $env:AWS_REGION='eu-west-1'
 *   node scripts/init-vapid.mjs [--secret merch-os/dev/support-chat] [--rotate]
 *
 * Keeps the existing secret fields (visitorTokenSecret). Does nothing if keys
 * already exist unless --rotate is given; rotating means every agent browser
 * must enable notifications again. Prints only the PUBLIC key.
 */
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import webpush from 'web-push';

const args = process.argv.slice(2);
const secretIdx = args.indexOf('--secret');
const secretId = secretIdx >= 0 ? args[secretIdx + 1] : 'merch-os/dev/support-chat';
const rotate = args.includes('--rotate');

const client = new SecretsManagerClient({});
const current = JSON.parse(
  (await client.send(new GetSecretValueCommand({ SecretId: secretId }))).SecretString ?? '{}',
);

if (!current.visitorTokenSecret) {
  console.error('Error: the secret has no visitorTokenSecret. Deploy the SupportChat stack first.');
  process.exit(1);
}
if (current.vapidPublicKey && current.vapidPrivateKey && !rotate) {
  console.log('VAPID keys already present; nothing changed.');
  console.log(`Public key: ${current.vapidPublicKey}`);
  process.exit(0);
}

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
await client.send(
  new PutSecretValueCommand({
    SecretId: secretId,
    SecretString: JSON.stringify({ ...current, vapidPublicKey: publicKey, vapidPrivateKey: privateKey }),
  }),
);
console.log(`VAPID keys ${rotate ? 'rotated' : 'added'}.`);
console.log(`Public key: ${publicKey}`);
