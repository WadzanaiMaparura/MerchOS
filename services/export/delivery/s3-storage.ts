/**
 * AWS S3 implementation of the ObjectStoragePort.
 *
 * Kept separate from the pure delivery logic so unit tests can use an in-memory
 * stub and only this adapter touches the AWS SDK.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStoragePort, PutObjectArgs } from './delivery.js';

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  /** Optional KMS key id/arn for SSE-KMS (exports bucket is KMS-encrypted). */
  kmsKeyId?: string;
  client?: S3Client;
}

export class S3ObjectStorage implements ObjectStoragePort {
  public readonly bucket: string;
  private readonly client: S3Client;
  private readonly kmsKeyId: string | undefined;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.kmsKeyId = config.kmsKeyId;
    this.client =
      config.client ?? new S3Client(config.region ? { region: config.region } : {});
  }

  async putObject(args: PutObjectArgs): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: args.key,
        Body: args.body,
        ContentType: args.contentType,
        ...(this.kmsKeyId
          ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.kmsKeyId }
          : {}),
      })
    );
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds }
    );
  }
}
