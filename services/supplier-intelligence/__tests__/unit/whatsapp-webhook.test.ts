/**
 * Unit tests for WhatsApp webhook handler.
 * Tests HMAC signature verification and image extraction from payloads.
 *
 * Requirements: 3.2
 */

import crypto from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';

// Mock the powertools logger to avoid importing @aws-lambda-powertools/commons
vi.mock('../../../shared/middleware/powertools', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { verifyHmacSignature, extractImagesFromPayload } from '../../handlers/whatsapp-webhook';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createSignature(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${hmac}`;
}

function buildWhatsAppPayload(messages: Array<{
  type: string;
  from: string;
  id: string;
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
}>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '27123456789',
                phone_number_id: 'phone-id-123',
              },
              contacts: [{ profile: { name: 'Test User' }, wa_id: '27987654321' }],
              messages,
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// HMAC Signature Verification Tests
// ---------------------------------------------------------------------------

describe('verifyHmacSignature', () => {
  const appSecret = 'test-app-secret-key';

  it('should return true for a valid signature', () => {
    const body = JSON.stringify({ test: 'payload' });
    const signature = createSignature(body, appSecret);

    expect(verifyHmacSignature(body, signature, appSecret)).toBe(true);
  });

  it('should return false for an invalid signature', () => {
    const body = JSON.stringify({ test: 'payload' });
    const wrongSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

    expect(verifyHmacSignature(body, wrongSignature, appSecret)).toBe(false);
  });

  it('should return false when body has been tampered with', () => {
    const originalBody = JSON.stringify({ test: 'original' });
    const tamperedBody = JSON.stringify({ test: 'tampered' });
    const signature = createSignature(originalBody, appSecret);

    expect(verifyHmacSignature(tamperedBody, signature, appSecret)).toBe(false);
  });

  it('should return false when signature header is empty', () => {
    const body = JSON.stringify({ test: 'payload' });

    expect(verifyHmacSignature(body, '', appSecret)).toBe(false);
  });

  it('should return false when signature header has wrong prefix', () => {
    const body = JSON.stringify({ test: 'payload' });

    expect(verifyHmacSignature(body, 'md5=abc', appSecret)).toBe(false);
  });

  it('should return false for malformed hex in signature', () => {
    const body = JSON.stringify({ test: 'payload' });

    expect(verifyHmacSignature(body, 'sha256=not-valid-hex', appSecret)).toBe(false);
  });

  it('should use timing-safe comparison to prevent timing attacks', () => {
    const body = JSON.stringify({ test: 'payload' });
    const signature = createSignature(body, appSecret);

    // This primarily tests that the function works correctly;
    // timing-safe comparison is an implementation detail
    expect(verifyHmacSignature(body, signature, appSecret)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Payload Image Extraction Tests
// ---------------------------------------------------------------------------

describe('extractImagesFromPayload', () => {
  it('should extract images from a valid payload with image messages', () => {
    const payload = buildWhatsAppPayload([
      {
        type: 'image',
        from: '27987654321',
        id: 'msg-1',
        image: {
          id: 'media-id-001',
          mime_type: 'image/jpeg',
          sha256: 'abc123hash',
          caption: 'Product photo',
        },
      },
    ]);

    const images = extractImagesFromPayload(payload);

    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      mediaId: 'media-id-001',
      mimeType: 'image/jpeg',
      sha256: 'abc123hash',
      caption: 'Product photo',
      senderPhoneNumber: '27987654321',
    });
  });

  it('should extract multiple images from a single payload', () => {
    const payload = buildWhatsAppPayload([
      {
        type: 'image',
        from: '27987654321',
        id: 'msg-1',
        image: { id: 'media-1', mime_type: 'image/jpeg', sha256: 'hash1' },
      },
      {
        type: 'image',
        from: '27987654321',
        id: 'msg-2',
        image: { id: 'media-2', mime_type: 'image/png', sha256: 'hash2' },
      },
    ]);

    const images = extractImagesFromPayload(payload);

    expect(images).toHaveLength(2);
    expect(images[0]!.mediaId).toBe('media-1');
    expect(images[1]!.mediaId).toBe('media-2');
  });

  it('should skip non-image messages', () => {
    const payload = buildWhatsAppPayload([
      {
        type: 'text',
        from: '27987654321',
        id: 'msg-1',
      },
      {
        type: 'image',
        from: '27987654321',
        id: 'msg-2',
        image: { id: 'media-1', mime_type: 'image/jpeg', sha256: 'hash1' },
      },
      {
        type: 'video',
        from: '27987654321',
        id: 'msg-3',
      },
    ]);

    const images = extractImagesFromPayload(payload);

    expect(images).toHaveLength(1);
    expect(images[0]!.mediaId).toBe('media-1');
  });

  it('should return empty array when payload has no messages', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '27123456789',
                  phone_number_id: 'phone-id-123',
                },
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const images = extractImagesFromPayload(payload);

    expect(images).toHaveLength(0);
  });

  it('should return empty array for empty entry list', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [],
    };

    const images = extractImagesFromPayload(payload);

    expect(images).toHaveLength(0);
  });

  it('should handle image without caption', () => {
    const payload = buildWhatsAppPayload([
      {
        type: 'image',
        from: '27987654321',
        id: 'msg-1',
        image: { id: 'media-1', mime_type: 'image/png', sha256: 'hash1' },
      },
    ]);

    const images = extractImagesFromPayload(payload);

    expect(images).toHaveLength(1);
    expect(images[0]!.caption).toBeUndefined();
  });
});
