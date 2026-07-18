# Implementation Plan: Pricing Page

## Overview

Build a dedicated `/pricing` route within the MerchOS seller-dashboard `(marketing)` route group. The page renders five subscription tiers as pricing cards, a feature comparison matrix, and an FAQ accordion — all driven by a single TypeScript configuration object. Implementation uses Next.js 14 App Router, Tailwind CSS with existing design tokens, and semantic HTML for accessibility.

## Tasks

- [x] 1. Create pricing configuration and types
  - [x] 1.1 Create the pricing config file with TypeScript types and data
    - Create `apps/seller-dashboard/app/config/pricing.ts`
    - Export `PricingTier`, `ComparisonFeature`, `ComparisonCategory`, `FAQItem`, and `PricingConfig` interfaces
    - Export `pricingConfig` object containing all five tiers (Launch, Growth, Professional, Business, Enterprise) with ZAR cent pricing, features, CTA labels, and hrefs
    - Include comparison matrix data grouped into categories with per-tier availability (boolean or string values)
    - Include all 7 required FAQ questions and answers
    - Export `formatPrice` utility function for converting cents to ZAR display format
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

- [x] 2. Create pricing page and hero section
  - [x] 2.1 Create the pricing page route file
    - Create `apps/seller-dashboard/app/(marketing)/pricing/page.tsx`
    - Export Next.js `metadata` with title "Pricing — MerchOS" and description
    - Server component that imports and composes PricingHero, PricingCards, ComparisonMatrix, and FAQSection
    - Pass config data as props to each section component
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.2 Create the PricingHero component
    - Create `apps/seller-dashboard/app/(marketing)/pricing/components/PricingHero.tsx`
    - Render section with heading containing "Pricing" and subtitle (≤ 150 chars) describing MerchOS subscription offerings
    - Use existing marketing page heading scale: `text-3xl sm:text-4xl font-bold text-gray-900` for heading, `text-lg text-gray-600` for subtitle
    - Use container constraint `max-w-7xl px-4 sm:px-6 lg:px-8` and section padding `py-20 sm:py-28`
    - _Requirements: 1.2, 9.3, 9.4_

- [x] 3. Implement pricing cards
  - [x] 3.1 Create the PricingCard component
    - Create `apps/seller-dashboard/app/(marketing)/pricing/components/PricingCard.tsx`
    - Accept `PricingTier` prop and render: tier name, formatted price (or "Contact Us" for null), badge (if present), feature list, and CTA button
    - Apply highlighted styling when `tier.highlighted` is true: accent border (`border-primary-600`), tinted background (`bg-primary-50`), elevated shadow (`shadow-lg`), increased vertical scale (`scale-105`), "Most Popular" badge
    - Apply standard styling for non-highlighted: white background, `border-gray-200`, `shadow-sm`
    - CTA button: filled primary style (`bg-primary-600 text-white`) for highlighted, outlined style (`border border-primary-600 text-primary-600 bg-transparent`) for non-highlighted
    - Add hover animation: CSS `transition-transform duration-200 ease-out hover:-translate-y-1 hover:shadow-md` using only transform/box-shadow (no layout reflow)
    - Ensure CTA button is keyboard-operable with visible focus indicator (3:1 contrast ratio)
    - Use card border radius `rounded-xl` consistent with marketing page
    - _Requirements: 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 9.3_

  - [x] 3.2 Create the PricingCards grid component
    - Create `apps/seller-dashboard/app/(marketing)/pricing/components/PricingCards.tsx`
    - Accept `PricingTier[]` prop, iterate and render PricingCard for each tier
    - Responsive grid: single row on desktop (≥1024px), multi-row grid on tablet (768px–1023px), vertical stack on mobile (<768px)
    - Maintain tier order: Launch, Growth, Professional, Business, Enterprise
    - Use container constraint and section padding matching marketing page
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.4_

  - [x]* 3.3 Write property test for config-to-cards rendering completeness
    - **Property 1: Config-to-cards rendering completeness**
    - Generate arbitrary valid PricingConfig with 1–10 tiers using fast-check
    - Verify rendered card count equals tier count, each card displays correct name, price, features, badge, and CTA
    - **Validates: Requirements 2.1, 2.5, 2.6, 4.1, 4.2, 8.4**

  - [x]* 3.4 Write property test for highlighted vs non-highlighted styling
    - **Property 2: Highlighted vs non-highlighted styling differentiation**
    - Generate random tiers with varying `highlighted` flag using fast-check
    - Verify highlighted cards have accent border, tinted background, elevated shadow, filled CTA; non-highlighted have standard styling; classes are mutually exclusive
    - **Validates: Requirements 3.1, 4.4, 4.5**

- [x] 4. Checkpoint - Verify pricing cards render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement comparison matrix
  - [x] 5.1 Create the ComparisonMatrix component
    - Create `apps/seller-dashboard/app/(marketing)/pricing/components/ComparisonMatrix.tsx`
    - Accept `ComparisonCategory[]` and `PricingTier[]` props
    - Render HTML `<table>` with `<th scope="col">` for plan name headers and `<th scope="row">` for feature name headers
    - Render category heading rows spanning all columns with visual differentiation (bold font weight or distinct background)
    - Render feature rows with cells showing: checkmark icon for `true`, cross icon for `false`, literal string value for string entries
    - Decorative icons: add `aria-hidden="true"` and adjacent visually-hidden `<span>` with "Included" or "Not included"
    - Mobile responsive: horizontal scroll wrapper with sticky first column for feature names on viewports < 768px
    - Use section heading scale and container constraint consistent with marketing page
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.5, 9.1, 10.2, 10.6_

  - [x]* 5.2 Write property test for comparison matrix rendering
    - **Property 3: Comparison matrix config-to-table rendering**
    - Generate random categories (1–5) with features (1–20) and tiers (2–8) using fast-check
    - Verify category heading row count, feature row count, tier column header count, and correct cell rendering (checkmark/cross/string)
    - **Validates: Requirements 6.2, 6.3, 6.5, 8.5**

  - [x]* 5.3 Write property test for matrix icon accessibility
    - **Property 6: Matrix icon accessibility semantics**
    - Generate random comparison matrix with mixed boolean/string values using fast-check
    - Verify every decorative icon has `aria-hidden="true"` and an adjacent visually-hidden span with semantic text
    - **Validates: Requirements 10.6**

- [x] 6. Implement FAQ accordion
  - [x] 6.1 Create the FAQSection client component
    - Create `apps/seller-dashboard/app/(marketing)/pricing/components/FAQSection.tsx`
    - Add `"use client"` directive at top
    - Accept `FAQItem[]` prop and manage state for currently expanded item (exclusive accordion: one open at a time)
    - Render section heading, then list of FAQ items with trigger buttons and answer panels
    - All items collapsed on initial load (`aria-expanded="false"`)
    - Expand/collapse animation completing within 300ms using CSS transitions
    - Trigger buttons: `aria-expanded` attribute toggling, `aria-controls` linking to answer panel `id`
    - Ensure keyboard operability (Enter/Space) with visible focus indicators
    - Use section heading scale and container constraint consistent with marketing page
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.1, 10.3, 10.4_

  - [x]* 6.2 Write property test for FAQ accordion exclusivity
    - **Property 4: FAQ accordion exclusivity**
    - Generate random FAQ items (1–15) with random activation sequences using fast-check
    - Verify at most one item is expanded at any given time after each activation
    - **Validates: Requirements 7.5**

  - [x]* 6.3 Write property test for aria-controls linkage
    - **Property 5: Accessible aria-controls linkage**
    - Generate random FAQ items (1–15) using fast-check
    - Verify each trigger button's `aria-controls` value matches the corresponding answer panel's `id`, and both are non-empty
    - **Validates: Requirements 10.3**

- [x] 7. Checkpoint - Verify all sections render and pass tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integration, accessibility, and visual polish
  - [x] 8.1 Wire all components together and verify full page rendering
    - Ensure `page.tsx` correctly imports all components and passes config props
    - Verify the page renders within the existing `(marketing)` layout with header and footer visible
    - Verify all color tokens used are from the seller-dashboard Tailwind config (primary-50 through primary-900, gray-100 through gray-900)
    - Verify consistent use of font family, container constraints, section padding, and card styling
    - _Requirements: 1.1, 9.1, 9.2, 9.3, 9.4_

  - [x] 8.2 Verify semantic HTML and keyboard accessibility
    - Confirm page uses semantic elements: headings, lists, table, buttons throughout
    - Confirm all interactive elements reachable via Tab key and operable via Enter/Space
    - Confirm visible focus indicators with ≥ 3:1 contrast ratio
    - Confirm colour contrast ratio ≥ 4.5:1 for all text content (WCAG 2.1 AA)
    - _Requirements: 10.1, 10.4, 10.5_

  - [x]* 8.3 Write unit tests for page structure and accessibility
    - Test page heading contains "Pricing", subtitle ≤ 150 characters
    - Test all 7 required FAQ questions are present
    - Test comparison matrix uses `<table>`, `<th>` with `scope` attributes
    - Test FAQ accordion initial state (all collapsed)
    - Test responsive layout classes are applied correctly
    - Test highlighted card has non-color indicator for colour vision deficiency support
    - _Requirements: 1.2, 3.4, 6.2, 7.1, 7.2, 10.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, consistent with the existing seller-dashboard codebase
- All components follow the existing marketing page patterns (container constraints, spacing, typography)
- Only the FAQSection requires `"use client"` — all other components are server components for optimal performance

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "5.1", "6.1"] },
    { "id": 3, "tasks": ["3.2", "5.2", "5.3", "6.2", "6.3"] },
    { "id": 4, "tasks": ["3.3", "3.4", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3"] }
  ]
}
```
