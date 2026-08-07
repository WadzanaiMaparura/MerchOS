/**
 * Unit tests for the custom CloudWatch metrics utility.
 *
 * Verifies that each helper function emits the correct metric name,
 * value, unit, and dimensions via AWS Powertools Metrics.
 *
 * @see Requirements 13.1, 13.2, 13.3, 13.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricUnit } from '@aws-lambda-powertools/metrics';

// Mock the Metrics class before importing the module under test
const mockAddMetric = vi.fn();
const mockAddDimension = vi.fn();
const mockPublishStoredMetrics = vi.fn();

vi.mock('@aws-lambda-powertools/metrics', () => {
  return {
    Metrics: vi.fn().mockImplementation(() => ({
      addMetric: mockAddMetric,
      addDimension: mockAddDimension,
      publishStoredMetrics: mockPublishStoredMetrics,
    })),
    MetricUnit: {
      Count: 'Count',
      Milliseconds: 'Milliseconds',
    },
  };
});

import {
  recordImportInitiated,
  recordImportCompleted,
  recordImportFailed,
  recordImportDuration,
  recordProductsExtracted,
  resetMetricsForTesting,
  getMetricsInstance,
} from '../../utils/metrics';

describe('Metrics Utility', () => {
  const dimensions = { tenantId: 'tenant-123', sourceType: 'FILE_CSV' };

  beforeEach(() => {
    vi.clearAllMocks();
    resetMetricsForTesting();
  });

  describe('getMetricsInstance', () => {
    it('returns a singleton Metrics instance', () => {
      const instance1 = getMetricsInstance();
      const instance2 = getMetricsInstance();
      expect(instance1).toBe(instance2);
    });

    it('creates a new instance after resetMetricsForTesting', () => {
      const instance1 = getMetricsInstance();
      resetMetricsForTesting();
      const instance2 = getMetricsInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('recordImportInitiated', () => {
    it('emits ImportsInitiated counter with correct dimensions', () => {
      recordImportInitiated(dimensions);

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-123');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'FILE_CSV');
      expect(mockAddMetric).toHaveBeenCalledWith('ImportsInitiated', MetricUnit.Count, 1);
      expect(mockPublishStoredMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordImportCompleted', () => {
    it('emits ImportsCompleted counter with correct dimensions', () => {
      recordImportCompleted(dimensions);

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-123');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'FILE_CSV');
      expect(mockAddMetric).toHaveBeenCalledWith('ImportsCompleted', MetricUnit.Count, 1);
      expect(mockPublishStoredMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordImportFailed', () => {
    it('emits ImportsFailed counter with correct dimensions', () => {
      recordImportFailed(dimensions);

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-123');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'FILE_CSV');
      expect(mockAddMetric).toHaveBeenCalledWith('ImportsFailed', MetricUnit.Count, 1);
      expect(mockPublishStoredMetrics).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordImportDuration', () => {
    it('emits ImportDuration in milliseconds with correct dimensions', () => {
      recordImportDuration(dimensions, 4500);

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-123');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'FILE_CSV');
      expect(mockAddMetric).toHaveBeenCalledWith('ImportDuration', MetricUnit.Milliseconds, 4500);
      expect(mockPublishStoredMetrics).toHaveBeenCalledTimes(1);
    });

    it('handles zero duration', () => {
      recordImportDuration(dimensions, 0);

      expect(mockAddMetric).toHaveBeenCalledWith('ImportDuration', MetricUnit.Milliseconds, 0);
    });

    it('handles large duration values', () => {
      recordImportDuration(dimensions, 3_600_000); // 1 hour

      expect(mockAddMetric).toHaveBeenCalledWith('ImportDuration', MetricUnit.Milliseconds, 3_600_000);
    });
  });

  describe('recordProductsExtracted', () => {
    it('emits ProductsExtracted counter with correct dimensions and count', () => {
      recordProductsExtracted(dimensions, 42);

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-123');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'FILE_CSV');
      expect(mockAddMetric).toHaveBeenCalledWith('ProductsExtracted', MetricUnit.Count, 42);
      expect(mockPublishStoredMetrics).toHaveBeenCalledTimes(1);
    });

    it('handles zero products extracted', () => {
      recordProductsExtracted(dimensions, 0);

      expect(mockAddMetric).toHaveBeenCalledWith('ProductsExtracted', MetricUnit.Count, 0);
    });
  });

  describe('dimension variations', () => {
    it('works with IMAGE source type', () => {
      recordImportInitiated({ tenantId: 'tenant-xyz', sourceType: 'IMAGE' });

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-xyz');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'IMAGE');
    });

    it('works with URL source type', () => {
      recordImportCompleted({ tenantId: 'tenant-abc', sourceType: 'URL' });

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-abc');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'URL');
    });

    it('works with FILE_EXCEL source type', () => {
      recordImportFailed({ tenantId: 'tenant-001', sourceType: 'FILE_EXCEL' });

      expect(mockAddDimension).toHaveBeenCalledWith('tenantId', 'tenant-001');
      expect(mockAddDimension).toHaveBeenCalledWith('sourceType', 'FILE_EXCEL');
    });
  });
});
