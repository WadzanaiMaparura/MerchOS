# Requirements Document

## Introduction

This document defines the requirements for a dedicated pricing page on the MerchOS marketing website (seller-dashboard). The page presents five subscription tiers (Launch, Growth, Professional, Business, Enterprise) with a feature comparison matrix and FAQ section. The implementation targets South African marketplace sellers with ZAR pricing and must be fully responsive, production-ready, and driven by a configuration object for future extensibility.

## Glossary

- **Pricing_Page**: The `/pricing` route within the `(marketing)` route group that displays subscription plans, a comparison matrix, and an FAQ section
- **Pricing_Card**: A visual card component representing a single subscription tier with name, price, badge, feature list, and call-to-action button
- **Comparison_Matrix**: A tabular section below pricing cards that maps features to plans using checkmarks or values
- **FAQ_Section**: An accordion or list of frequently asked questions with answers, displayed below the comparison matrix
- **Pricing_Config**: A TypeScript configuration object that defines all plan data, features, and FAQ content
- **CTA_Button**: A call-to-action button on each pricing card that navigates to a registration or contact flow
- **Highlighted_Card**: The recommended plan card (Professional) rendered with visual emphasis including accent colors, increased size, and a badge
- **Responsive_Layout**: A layout that displays cards side-by-side on desktop viewports and stacks them vertically on mobile viewports

## Requirements

### Requirement 1: Pricing Page Route

**User Story:** As a prospective seller, I want to navigate to a dedicated pricing page, so that I can evaluate MerchOS subscription options without distraction.

#### Acceptance Criteria

1. WHEN a user navigates to `/pricing`, THE Pricing_Page SHALL render within the existing `(marketing)` route group layout with the shared navigation header and footer visible on the page
2. THE Pricing_Page SHALL include a visible heading (page title) that contains the word "Pricing" and a subtitle of no more than 150 characters describing MerchOS subscription offerings
3. WHEN a user navigates to `/pricing`, THE Pricing_Page SHALL set a document title (browser tab title) that includes "Pricing" and "MerchOS"

---

### Requirement 2: Pricing Card Display

**User Story:** As a prospective seller, I want to see all available subscription plans displayed as cards, so that I can quickly compare tier names, prices, and included features.

#### Acceptance Criteria

1. THE Pricing_Page SHALL display exactly five Pricing_Card components representing the Launch, Growth, Professional, Business, and Enterprise tiers in that order from left to right on desktop
2. WHEN rendered on a desktop viewport (width 1024px or greater), THE Pricing_Page SHALL display all Pricing_Card components side-by-side in a single row
3. WHEN rendered on a tablet viewport (width 768px to 1023px), THE Pricing_Page SHALL display Pricing_Card components in a multi-row grid layout
4. WHEN rendered on a mobile viewport (width less than 768px), THE Pricing_Page SHALL stack all Pricing_Card components vertically in tier order (Launch first, Enterprise last)
5. Each Pricing_Card SHALL display the tier name, monthly price in ZAR (or "Contact Us" for Enterprise), a feature list showing all features defined in the Pricing_Config for that tier, and a CTA_Button
6. WHEN a Pricing_Card includes a badge value in the Pricing_Config, THE Pricing_Card SHALL render the badge above the tier name

---

### Requirement 3: Highlighted Recommended Plan

**User Story:** As a prospective seller, I want the recommended plan to be visually distinct, so that I can identify the most popular option at a glance.

#### Acceptance Criteria

1. THE Highlighted_Card (Professional tier) SHALL render with a visible border using the primary accent color and a tinted background color that differs from the non-highlighted cards' background and border colors
2. THE Highlighted_Card SHALL display a "Most Popular" badge positioned above or adjacent to the tier name
3. THE Highlighted_Card SHALL render with increased vertical scale (extending above adjacent cards) or an elevated visual layer so that it appears prominently raised compared to non-highlighted cards
4. THE Highlighted_Card SHALL be visually distinguishable from non-highlighted cards through at least one non-color indicator (such as size difference, border width, or badge presence) to support users with color vision deficiency

---

### Requirement 4: Call-to-Action Buttons

**User Story:** As a prospective seller, I want each plan to have a clear call-to-action, so that I can proceed to sign up or contact sales.

#### Acceptance Criteria

1. Each Pricing_Card SHALL display a CTA_Button with the label text defined in the Pricing_Config for that tier
2. WHEN a user activates the CTA_Button on plans Launch through Business, THE Pricing_Page SHALL navigate the user to the registration flow path specified in the Pricing_Config for that tier
3. WHEN a user activates the CTA_Button on the Enterprise plan, THE Pricing_Page SHALL navigate the user to the contact sales inquiry flow path specified in the Pricing_Config
4. THE CTA_Button on the Highlighted_Card SHALL render with a filled primary style (solid background using primary-600)
5. Each CTA_Button on a non-highlighted Pricing_Card SHALL render with an outlined style (transparent background with a visible border)
6. Each CTA_Button SHALL use its label text as the accessible name and SHALL be operable via keyboard activation (Enter or Space key)

---

### Requirement 5: Hover Animations

**User Story:** As a prospective seller, I want smooth visual feedback when interacting with pricing cards, so that the page feels polished and responsive.

#### Acceptance Criteria

1. WHEN a user hovers over a Pricing_Card, THE Pricing_Card SHALL apply a vertical translate or scale transform with a CSS transition duration of no more than 200ms and an easing timing function
2. THE hover animation SHALL use only CSS transform and box-shadow properties such that no layout reflow occurs and adjacent Pricing_Card components maintain their original position and dimensions
3. WHEN a user moves the pointer away from a Pricing_Card, THE Pricing_Card SHALL reverse the hover animation back to its default state within 200ms

---

### Requirement 6: Feature Comparison Matrix

**User Story:** As a prospective seller, I want to see a detailed feature-by-feature comparison across all plans, so that I can make an informed decision about which tier meets my needs.

#### Acceptance Criteria

1. THE Pricing_Page SHALL display a Comparison_Matrix section below the pricing cards
2. THE Comparison_Matrix SHALL list all features defined in the Pricing_Config as rows and all five plans as columns in tier order (Launch, Growth, Professional, Business, Enterprise from left to right)
3. Each cell in the Comparison_Matrix SHALL indicate feature availability using a checkmark icon for included features, a cross icon for excluded features, or a specific numeric or text value (e.g., "50", "300", "2,000")
4. WHEN rendered on a viewport width less than 768px, THE Comparison_Matrix SHALL support horizontal scrolling with the feature name column remaining visible (sticky) so the user can identify which feature each row represents while scrolling
5. THE Comparison_Matrix SHALL group features into categories as defined in the Pricing_Config, with each category visually separated by a category heading row spanning all columns
6. Each category heading row in the Comparison_Matrix SHALL display the category name and be visually distinct from feature rows through typographic weight or background differentiation

---

### Requirement 7: FAQ Section

**User Story:** As a prospective seller, I want to read answers to common pricing questions, so that I can resolve concerns without contacting support.

#### Acceptance Criteria

1. THE Pricing_Page SHALL display a FAQ_Section below the Comparison_Matrix with all questions in a collapsed state on initial page load
2. THE FAQ_Section SHALL include at minimum the following questions: "Can I upgrade later?", "Can I downgrade?", "What happens if I exceed my AI allowance?", "Is there a free trial?", "Do unused AI credits roll over?", "Which marketplaces are supported?", "Can I cancel anytime?"
3. WHEN a user activates a question in the FAQ_Section, THE FAQ_Section SHALL reveal the corresponding answer with an expand animation completing within 300ms
4. WHEN a user activates an already-expanded question, THE FAQ_Section SHALL collapse the answer with a collapse animation completing within 300ms
5. WHEN a user activates a collapsed question while another question is already expanded, THE FAQ_Section SHALL collapse the previously expanded answer and expand the newly activated answer

---

### Requirement 8: Configuration-Driven Data

**User Story:** As a developer, I want all pricing data to come from a configuration object, so that plans, features, and FAQ content can be updated without modifying UI component code.

#### Acceptance Criteria

1. THE Pricing_Config SHALL be defined as a single TypeScript file exporting a typed configuration object that contains all tier data including name, price, currency, badge, feature list, CTA label, CTA destination, and highlight status
2. THE Pricing_Config SHALL define all Comparison_Matrix features grouped by category, with each feature specifying its availability per tier as a boolean or a specific value string
3. THE Pricing_Config SHALL define all FAQ questions and answers as an array of objects with question and answer string fields
4. WHEN a new tier is added to the Pricing_Config tiers array, THE Pricing_Page SHALL render the additional Pricing_Card without requiring changes to component logic
5. WHEN a new feature is added to the Pricing_Config comparison matrix data, THE Comparison_Matrix SHALL display the additional row without requiring changes to component logic
6. THE Pricing_Config file SHALL export TypeScript types for the configuration shape so that type errors are caught at compile time when modifying pricing data

---

### Requirement 9: Visual Design Consistency

**User Story:** As a prospective seller, I want the pricing page to look and feel consistent with the rest of the MerchOS website, so that I trust the brand experience.

#### Acceptance Criteria

1. THE Pricing_Page SHALL use only the color tokens defined in the seller-dashboard Tailwind CSS configuration (primary-50 through primary-900, gray-100 through gray-900) and the configured font family
2. THE Pricing_Page SHALL render within the existing `(marketing)` route group layout, inheriting the shared navigation header and footer without modification
3. THE Pricing_Page SHALL use the same container constraint (`max-w-7xl` with horizontal padding `px-4 sm:px-6 lg:px-8`), section vertical padding (`py-20 sm:py-28`), card border radius (`rounded-xl`), and card shadow (`shadow-sm` for standard cards, `shadow-lg` for highlighted cards) as the existing marketing landing page
4. THE Pricing_Page SHALL use the same heading scale as the marketing landing page: section headings at `text-3xl sm:text-4xl font-bold text-gray-900`, and body text at `text-sm` or `text-lg text-gray-600`

---

### Requirement 10: Accessibility

**User Story:** As a prospective seller using assistive technology, I want the pricing page to be navigable and understandable, so that I can evaluate plans regardless of my abilities.

#### Acceptance Criteria

1. THE Pricing_Page SHALL use semantic HTML elements (headings, lists, tables, buttons) for all content sections
2. THE Comparison_Matrix SHALL use a proper HTML `<table>` element with `<th>` column headers for plan names and `<th>` row headers for feature names, with `scope` attributes set appropriately for screen reader compatibility
3. THE FAQ_Section SHALL implement accessible accordion patterns with `aria-expanded` on trigger buttons and `aria-controls` linking to the associated answer panel
4. All interactive elements on the Pricing_Page SHALL be reachable via sequential keyboard navigation (Tab key) and operable via keyboard activation (Enter or Space key), with a visible focus indicator having a minimum 3:1 contrast ratio against adjacent colours
5. THE Pricing_Page SHALL maintain a minimum colour contrast ratio of 4.5:1 for all text content as defined by WCAG 2.1 Level AA
6. Decorative icons (checkmarks, crosses) in the Comparison_Matrix SHALL include `aria-hidden="true"` and adjacent visually-hidden text providing the semantic meaning (e.g., "Included" or "Not included")
