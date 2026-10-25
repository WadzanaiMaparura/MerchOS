# CloudFront Signed-URL Key Rotation Runbook — Image Intelligence

> Applies to the Image Intelligence Engine's signed-URL delivery (Phase 3).
> The signing **private key** lives in AWS Secrets Manager; the matching
> **public key** is registered in a CloudFront Key Group used by the image
> distribution. Rotating the key pair must avoid breaking already-issued URLs.

## Background

- **Private key:** Secrets Manager secret `merch-os/{env}/image-signing-private-key` (PEM), encrypted with the Foundation secrets KMS key.
- **Public key:** CloudFront `PublicKey` → `KeyGroup` (`merch-os-img-keygroup-{env}`), referenced as a trusted key group on the distribution's default behaviour.
- The `signed-url` Lambda reads the private key by **secret id from env** (`CLOUDFRONT_PRIVATE_KEY_SECRET_ID`) and signs with the **key-pair id from env** (`CLOUDFRONT_KEY_PAIR_ID`). Because both are configuration, the key can change without a code change.
- Signed URLs are short-lived (1 hour TTL), which bounds the overlap window during rotation.

## Rotation procedure (zero-downtime)

A CloudFront **Key Group can hold multiple public keys**, so both the old and new keys can verify URLs simultaneously during the overlap window.

1. **Generate a new RSA key pair** (2048-bit), locally or in a secure environment:
   ```bash
   openssl genrsa -out new-private.pem 2048
   openssl rsa -pubout -in new-private.pem -out new-public.pem
   ```
2. **Add the new public key** to CloudFront as a new `PublicKey` and add it to the existing `KeyGroup` (now the group contains old + new). Deploy via CDK (add the second key to the key group's `items`).
3. **Wait for the distribution to finish deploying** (status `Deployed`). Both keys now verify.
4. **Update the Secrets Manager secret** to the new private key PEM, and update `CLOUDFRONT_KEY_PAIR_ID` (the Lambda env) to the new public key's id. New URLs are now signed with the new key; old URLs (signed with the old key) still verify because the old public key is still in the group.
5. **Wait out the TTL** (≥ 1 hour) so all URLs signed with the old key have expired.
6. **Remove the old public key** from the key group and delete the old `PublicKey`. Deploy. Rotation complete.

## Emergency revocation (suspected key compromise)

Skip the overlap window:

1. Immediately replace the Secrets Manager secret with a fresh private key and update the key-pair id env.
2. Remove the compromised public key from the key group and deploy.
3. All URLs signed with the compromised key stop verifying at once (any outstanding ones are rejected). Accept that in-flight legitimate URLs break — this is the trade-off for immediate revocation.

## Notes

- The private key PEM must **never** be committed to source or baked into a Lambda bundle — it is only ever read from Secrets Manager at runtime.
- The Lambda caches the private key in memory across invocations; a rotation takes effect on new execution environments (or after the cache TTL / cold start). For an immediate cutover, force new execution environments (e.g. publish a new Lambda version) after step 4.
- Keep rotation on a schedule (e.g. every 90 days) in addition to emergency rotations.
