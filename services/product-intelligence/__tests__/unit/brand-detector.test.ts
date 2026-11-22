/**
 * Unit tests for the Brand Detector service.
 *
 * Tests brand identification, primary vs sub-brand differentiation,
 * registry validation, and unidentified flagging.
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { ConverseCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { BrandDetector, type BrandDetectionInput } from '../../services/brand-detector';
import { resetClientsForTesting } from '../../services/bedrock-client';
import { getModelConfig } from '../../services/model-config';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const bedrockMock = mockClient(BedrockRuntimeClient);

function buildBedrockResponse(content: string) {
  // Converse API response shape.
  return {
    output: { message: { role: 'assistant' as const, content: [{ text: content }] } },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    stopReason: 'end_turn' as const,
    metrics: { latencyMs: 1 },
  };
}

function buildInput(overrides?: Partial<BrandDetectionInput>): BrandDetectionInput {
  return {
    text: 'Nike Air Max 90 running shoes with Flyknit technology',
    productData: {
      name: 'Nike Air Max 90',
      category: 'Shoes',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  bedrockMock.reset();
  resetClientsForTesting();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrandDetector', () => {
  describe('detect', () => {
    it('should detect primary brand and sub-brands from product text', async () => {
      const responseContent = JSON.stringify([
        { name: 'Nike', type: 'primary', confidenceScore: 0.95 },
        { name: 'Air Max', type: 'sub-brand', confidenceScore: 0.88 },
      ]);

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      const result = await detector.detect(buildInput());

      expect(result.brands).toHaveLength(2);
      expect(result.brands[0]).toEqual({
        name: 'Nike',
        type: 'primary',
        confidenceScore: 0.95,
        recognized: true,
      });
      expect(result.brands[1]).toEqual({
        name: 'Air Max',
        type: 'sub-brand',
        confidenceScore: 0.88,
        recognized: true,
      });
      expect(result.unidentified).toBe(false);
    });

    it('should set unidentified=true when no brand exceeds 0.5 confidence', async () => {
      const responseContent = JSON.stringify([
        { name: 'GenericBrand', type: 'primary', confidenceScore: 0.3 },
        { name: 'SubBrand', type: 'sub-brand', confidenceScore: 0.2 },
      ]);

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      const result = await detector.detect(buildInput());

      expect(result.unidentified).toBe(true);
      expect(result.brands[0]!.recognized).toBe(false);
      expect(result.brands[1]!.recognized).toBe(false);
    });

    it('should set unidentified=true when empty array is returned', async () => {
      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse('[]'));

      const detector = new BrandDetector();
      const result = await detector.detect(buildInput());

      expect(result.brands).toHaveLength(0);
      expect(result.unidentified).toBe(true);
    });

    it('should validate brands against registry and set registryValidated', async () => {
      const responseContent = JSON.stringify([
        { name: 'Nike', type: 'primary', confidenceScore: 0.95 },
        { name: 'FakeBrand', type: 'sub-brand', confidenceScore: 0.8 },
      ]);

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      const result = await detector.detect(
        buildInput({ brandRegistry: ['Nike', 'Adidas', 'Puma'] }),
      );

      expect(result.brands[0]).toEqual({
        name: 'Nike',
        type: 'primary',
        confidenceScore: 0.95,
        registryValidated: true,
        recognized: true,
      });
      expect(result.brands[1]).toEqual({
        name: 'FakeBrand',
        type: 'sub-brand',
        confidenceScore: 0.8,
        registryValidated: false,
        recognized: false,
      });
    });

    it('should perform case-insensitive registry validation', async () => {
      const responseContent = JSON.stringify([
        { name: 'nike', type: 'primary', confidenceScore: 0.9 },
      ]);

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      const result = await detector.detect(
        buildInput({ brandRegistry: ['Nike', 'Adidas'] }),
      );

      expect(result.brands[0]!.registryValidated).toBe(true);
      expect(result.brands[0]!.recognized).toBe(true);
    });

    it('should handle malformed model response gracefully', async () => {
      bedrockMock.on(ConverseCommand).resolves(
        buildBedrockResponse('This is not JSON at all'),
      );

      const detector = new BrandDetector();
      const result = await detector.detect(buildInput());

      expect(result.brands).toHaveLength(0);
      expect(result.unidentified).toBe(true);
    });

    it('should extract JSON from responses with extra text', async () => {
      const responseContent = `Here are the brands I found:\n${JSON.stringify([
        { name: 'Samsung', type: 'primary', confidenceScore: 0.92 },
      ])}\nThat's all.`;

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      const result = await detector.detect(
        buildInput({ text: 'Samsung Galaxy S24 Ultra smartphone' }),
      );

      expect(result.brands).toHaveLength(1);
      expect(result.brands[0]!.name).toBe('Samsung');
    });

    it('should clamp confidence scores to [0, 1] range', async () => {
      const responseContent = JSON.stringify([
        { name: 'TestBrand', type: 'primary', confidenceScore: 1.5 },
        { name: 'LowBrand', type: 'sub-brand', confidenceScore: -0.3 },
      ]);

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      const result = await detector.detect(buildInput());

      expect(result.brands[0]!.confidenceScore).toBe(1.0);
      expect(result.brands[1]!.confidenceScore).toBe(0.0);
    });

    it('should filter out invalid entries from the response', async () => {
      const responseContent = JSON.stringify([
        { name: 'Nike', type: 'primary', confidenceScore: 0.9 },
        { name: 123, type: 'primary', confidenceScore: 0.8 },  // invalid name
        { name: 'Adidas', type: 'invalid', confidenceScore: 0.7 },  // invalid type
        { name: 'Puma', type: 'primary' },  // missing confidence
      ]);

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      const result = await detector.detect(buildInput());

      expect(result.brands).toHaveLength(1);
      expect(result.brands[0]!.name).toBe('Nike');
    });

    it('should use brand model config for Bedrock invocation', async () => {
      const responseContent = JSON.stringify([
        { name: 'Nike', type: 'primary', confidenceScore: 0.9 },
      ]);

      bedrockMock.on(ConverseCommand).resolves(buildBedrockResponse(responseContent));

      const detector = new BrandDetector();
      await detector.detect(buildInput());

      const calls = bedrockMock.commandCalls(ConverseCommand);
      expect(calls).toHaveLength(1);
      // Assert against the configured brand model rather than a literal id: the
      // model is pinned in model-config.ts and changes with each model upgrade
      // (this assertion went stale when the config moved to inference profiles).
      expect(calls[0]!.args[0].input.modelId).toBe(getModelConfig('brand').modelId);
    });
  });
});
