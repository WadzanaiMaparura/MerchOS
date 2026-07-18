// Unit tests for pricing page structure and accessibility
// Validates: Requirements 1.2, 3.4, 6.2, 7.1, 7.2, 10.2

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PricingHero } from '@/app/(marketing)/pricing/components/PricingHero';
import { FAQSection } from '@/app/(marketing)/pricing/components/FAQSection';
import { ComparisonMatrix } from '@/app/(marketing)/pricing/components/ComparisonMatrix';
import { PricingCards } from '@/app/(marketing)/pricing/components/PricingCards';
import { PricingCard } from '@/app/(marketing)/pricing/components/PricingCard';
import { pricingConfig } from '@/app/config/pricing';

// Mock next/link as a simple anchor element
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) =>
    React.createElement('a', { href, className }, children),
}));

describe('PricingHero', () => {
  it('renders heading with "Pricing"', () => {
    render(<PricingHero />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('Pricing');
  });

  it('subtitle is ≤ 150 characters', () => {
    const { container } = render(<PricingHero />);
    const paragraph = container.querySelector('p');
    expect(paragraph).not.toBeNull();
    expect(paragraph!.textContent!.length).toBeLessThanOrEqual(150);
  });
});

describe('FAQSection', () => {
  it('renders all 7 FAQ questions', () => {
    render(<FAQSection items={pricingConfig.faq} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(7);
    pricingConfig.faq.forEach((item) => {
      expect(screen.getByText(item.question)).toBeTruthy();
    });
  });

  it('starts with all items collapsed (aria-expanded="false")', () => {
    render(<FAQSection items={pricingConfig.faq} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });
  });
});

describe('ComparisonMatrix', () => {
  it('uses semantic table with scope attributes', () => {
    const { container } = render(
      <ComparisonMatrix categories={pricingConfig.comparison} tiers={pricingConfig.tiers} />
    );

    // Has a <table> element
    const table = container.querySelector('table');
    expect(table).not.toBeNull();

    // Has <th> with scope="col" for tier headers
    const colHeaders = container.querySelectorAll('th[scope="col"]');
    expect(colHeaders.length).toBeGreaterThan(0);

    // Has <th> with scope="row" for feature/category row headers
    const rowHeaders = container.querySelectorAll('th[scope="row"]');
    expect(rowHeaders.length).toBeGreaterThan(0);
  });
});

describe('PricingCards', () => {
  it('grid applies responsive layout classes', () => {
    const { container } = render(<PricingCards tiers={pricingConfig.tiers} />);
    const grid = container.querySelector('[class*="grid"]');
    expect(grid).not.toBeNull();
    const classList = grid!.className;
    expect(classList).toContain('grid-cols-1');
    expect(classList).toContain('md:grid-cols-2');
    expect(classList).toContain('lg:grid-cols-5');
  });
});

describe('Highlighted card non-color differentiation', () => {
  it('highlighted card has non-color indicator (scale/border-width/badge)', () => {
    const professionalTier = pricingConfig.tiers.find((t) => t.id === 'professional')!;
    const { container } = render(<PricingCard tier={professionalTier} />);
    const card = container.firstElementChild as HTMLElement;

    // The highlighted card should have at least one non-color differentiation indicator:
    // - scale-105 (size difference)
    // - border-2 (thicker border)
    // - badge text "Most Popular"
    const hasScale = card.className.includes('scale-105');
    const hasBorderWidth = card.className.includes('border-2');
    const hasBadge = card.textContent?.includes('Most Popular');

    expect(hasScale || hasBorderWidth || hasBadge).toBe(true);
  });
});
