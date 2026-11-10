import { describe, it, expect } from 'vitest';
import { deliverExport, type ObjectStoragePort, type PutObjectArgs } from '../delivery.js';

function stubStorage() {
  const puts: PutObjectArgs[] = [];
  const signed: Array<{ key: string; expiresIn: number }> = [];
  const port: ObjectStoragePort = {
    bucket: 'merch-os-exports-test',
    async putObject(args) {
      puts.push(args);
    },
    async getSignedDownloadUrl(key, expiresInSeconds) {
      signed.push({ key, expiresIn: expiresInSeconds });
      return `https://signed.example/${key}?e=${expiresInSeconds}`;
    },
  };
  return { port, puts, signed };
}

describe('deliverExport', () => {
  it('writes a tenant-scoped key and returns a signed URL', async () => {
    const { port, puts, signed } = stubStorage();
    const artifact = await deliverExport(port, {
      tenantId: 't1',
      exportId: 'e1',
      filename: 'takealot-full-create-248-1.csv',
      format: 'CSV',
      body: 'h1,h2\r\na,b\r\n',
    });

    expect(artifact.key).toBe('tenants/t1/exports/e1/takealot-full-create-248-1.csv');
    expect(artifact.bucket).toBe('merch-os-exports-test');
    expect(artifact.expiresInSeconds).toBe(900); // default 15 min
    expect(artifact.downloadUrl).toContain(artifact.key);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.contentType).toBe('text/csv; charset=utf-8');
    expect(signed[0]!.expiresIn).toBe(900);
  });

  it('uses the XLSX content type for XLSX exports and honors custom expiry', async () => {
    const { port, puts } = stubStorage();
    const artifact = await deliverExport(port, {
      tenantId: 't1',
      exportId: 'e2',
      filename: 'takealot-full-create-248-1.xlsx',
      format: 'XLSX',
      body: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      expiresInSeconds: 60,
    });
    expect(artifact.expiresInSeconds).toBe(60);
    expect(puts[0]!.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });
});
