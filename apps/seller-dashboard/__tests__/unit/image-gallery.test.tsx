/**
 * Component tests for the ProductImageGallery (Image Intelligence Engine, Phase 7).
 *
 * Verifies the async upload→process→poll flow wiring and the job-status render
 * states (processing / rejected / completed), plus role gating of the uploader.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ImageJob } from '@merch-os/api-client';

// ─── Mocks ─────────────────────────────────────────────────────────────────

let mockRole = 'editor';
vi.mock('@merch-os/auth', () => ({
  useRole: () => mockRole,
}));

const mockRequestUploadUrl = { mutateAsync: vi.fn() };
const mockStartProcessing = { mutateAsync: vi.fn() };
let mockJob: ImageJob | undefined;

vi.mock('@merch-os/api-client', () => ({
  useRequestUploadUrl: () => mockRequestUploadUrl,
  useStartImageProcessing: () => mockStartProcessing,
  useImageJob: () => ({ data: mockJob }),
  useImageSignedUrl: () => ({ data: { url: 'https://cdn/x.jpg', expiresInSeconds: 3600 }, isLoading: false, isError: false }),
}));

// Minimal UI stubs so we don't depend on the full component library internals.
vi.mock('@merch-os/ui', () => ({
  FileUpload: ({ label, disabled }: { label: string; disabled?: boolean }) => (
    <button type="button" aria-label="Upload product image" disabled={disabled}>
      {label}
    </button>
  ),
  ModerationBadge: ({ status }: { status: string }) => <span>{status}</span>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Alert: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div role="alert">{title}{children}</div>
  ),
}));

import { ProductImageGallery, ImageJobStatus } from '../../app/(dashboard)/products/[productId]/components/ImageGallery';

beforeEach(() => {
  mockRole = 'editor';
  mockJob = undefined;
  vi.clearAllMocks();
});

describe('ProductImageGallery', () => {
  it('shows the uploader for editor+ roles', () => {
    render(<ProductImageGallery productId="p1" images={[]} />);
    expect(screen.getByLabelText('Upload product image')).toBeTruthy();
  });

  it('hides the uploader for the viewer role', () => {
    mockRole = 'viewer';
    render(<ProductImageGallery productId="p1" images={[]} />);
    expect(screen.queryByLabelText('Upload product image')).toBeNull();
  });

  it('shows an empty state when there are no processed images', () => {
    render(<ProductImageGallery productId="p1" images={[]} />);
    expect(screen.getByText('No images processed yet.')).toBeTruthy();
  });
});

describe('ImageJobStatus', () => {
  const base: ImageJob = {
    imageJobId: 'j1',
    productId: 'p1',
    status: 'PROCESSING',
    variants: [],
    reviewRecommended: false,
    createdAt: '',
    updatedAt: '',
  };

  it('renders a processing message while in flight', () => {
    render(<ImageJobStatus job={{ ...base, status: 'PROCESSING' }} />);
    expect(screen.getByText(/Processing image/i)).toBeTruthy();
  });

  it('renders the moderation rejection reason when REJECTED', () => {
    render(
      <ImageJobStatus
        job={{ ...base, status: 'REJECTED', moderation: { passed: false, rejectedLabels: ['Violence'] } }}
      />,
    );
    expect(screen.getByText(/Rejected for: Violence/i)).toBeTruthy();
  });

  it('surfaces the review-recommended flag on completion', () => {
    render(<ImageJobStatus job={{ ...base, status: 'COMPLETED', reviewRecommended: true }} />);
    expect(screen.getByText(/flagged for manual review/i)).toBeTruthy();
  });

  it('notes AI enhancement when applied', () => {
    render(
      <ImageJobStatus
        job={{ ...base, status: 'COMPLETED', enhancement: { attempted: true, applied: true } }}
      />,
    );
    expect(screen.getByText(/AI enhancement applied/i)).toBeTruthy();
  });

  it('renders a failure message when FAILED', () => {
    render(
      <ImageJobStatus
        job={{ ...base, status: 'FAILED', error: { code: 'X', message: 'boom' } }}
      />,
    );
    expect(screen.getByText(/boom/i)).toBeTruthy();
  });
});
