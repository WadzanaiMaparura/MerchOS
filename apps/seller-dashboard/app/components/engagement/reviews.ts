'use client';

/**
 * Approved seller reviews on the website.
 *
 * The reviews UI stays exactly as designed. Real reviews, once approved in the
 * admin dashboard, take the placeholder slots in order (the first approved
 * review fills slot 1, the next slot 2, ...). Slots without a real review keep
 * their placeholder. Nothing rotates.
 */

import { useEffect, useState } from 'react';
import { ENGAGEMENT_API_URL, fetchApprovedReviews, type PublicReview } from './engagement-api';

export function useApprovedReviews(): PublicReview[] {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  useEffect(() => {
    if (!ENGAGEMENT_API_URL) return;
    let cancelled = false;
    fetchApprovedReviews()
      .then((r) => {
        if (!cancelled) setReviews(r);
      })
      // The placeholders already show; a failed fetch changes nothing.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return reviews;
}

/** Replaces placeholders[i] with toSlot(real[i]) for each real review; same length. */
export function fillSlots<T>(placeholders: readonly T[], real: readonly PublicReview[], toSlot: (r: PublicReview, placeholder: T) => T): T[] {
  return placeholders.map((p, i) => (real[i] ? toSlot(real[i]!, p) : p));
}

/** "Thandi K." -> "TK" (avatar for real reviews, which have no photo). */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}]/gu, '').charAt(0))
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'M'
  );
}
