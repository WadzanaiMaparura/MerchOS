'use client';

import React from 'react';
import type { LifecycleState, ModerationStatus } from '@merch-os/types';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface BadgeProps {
  /** Text content of the badge */
  children: React.ReactNode;
  /** Visual variant */
  variant?: BadgeVariant;
  /** Additional CSS classes */
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700 border-gray-200',
  success: 'bg-green-100 text-green-800 border-green-200',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  error: 'bg-red-100 text-red-800 border-red-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  neutral: 'bg-gray-50 text-gray-600 border-gray-200',
};

/**
 * Badge - Small label for displaying statuses.
 * Used for lifecycle states, compliance status, and moderation status.
 */
export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${VARIANT_STYLES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

// --- Lifecycle Badge ---

const LIFECYCLE_VARIANT: Record<LifecycleState, BadgeVariant> = {
  DRAFT: 'neutral',
  INGESTED: 'info',
  ENRICHED: 'info',
  REVIEW: 'warning',
  VALIDATED: 'success',
  EXPORT_READY: 'success',
  PUBLISHED: 'success',
  ARCHIVED: 'default',
};

const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  DRAFT: 'Draft',
  INGESTED: 'Ingested',
  ENRICHED: 'Enriched',
  REVIEW: 'Review',
  VALIDATED: 'Validated',
  EXPORT_READY: 'Export Ready',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export interface LifecycleBadgeProps {
  state: LifecycleState;
  className?: string;
}

/**
 * LifecycleBadge - Displays a product lifecycle state with appropriate color coding.
 */
export function LifecycleBadge({ state, className }: LifecycleBadgeProps) {
  return (
    <Badge variant={LIFECYCLE_VARIANT[state]} className={className}>
      {LIFECYCLE_LABELS[state]}
    </Badge>
  );
}

// --- Compliance Badge ---

export type ComplianceStatus = 'PASS' | 'FAIL' | 'PENDING';

const COMPLIANCE_VARIANT: Record<ComplianceStatus, BadgeVariant> = {
  PASS: 'success',
  FAIL: 'error',
  PENDING: 'warning',
};

const COMPLIANCE_LABELS: Record<ComplianceStatus, string> = {
  PASS: 'Compliant',
  FAIL: 'Non-compliant',
  PENDING: 'Pending',
};

export interface ComplianceBadgeProps {
  status: ComplianceStatus;
  className?: string;
}

/**
 * ComplianceBadge - Displays compliance validation status.
 */
export function ComplianceBadge({ status, className }: ComplianceBadgeProps) {
  return (
    <Badge variant={COMPLIANCE_VARIANT[status]} className={className}>
      {COMPLIANCE_LABELS[status]}
    </Badge>
  );
}

// --- Moderation Badge ---

const MODERATION_VARIANT: Record<ModerationStatus, BadgeVariant> = {
  APPROVED: 'success',
  REJECTED: 'error',
  PENDING: 'warning',
};

const MODERATION_LABELS: Record<ModerationStatus, string> = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PENDING: 'Pending',
};

export interface ModerationBadgeProps {
  status: ModerationStatus;
  className?: string;
}

/**
 * ModerationBadge - Displays image moderation status.
 */
export function ModerationBadge({ status, className }: ModerationBadgeProps) {
  return (
    <Badge variant={MODERATION_VARIANT[status]} className={className}>
      {MODERATION_LABELS[status]}
    </Badge>
  );
}
