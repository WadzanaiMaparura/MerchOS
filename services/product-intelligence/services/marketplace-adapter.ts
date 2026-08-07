/**
 * Marketplace Adapter service for the Product Intelligence Engine.
 *
 * Applies marketplace-specific content rules to generated output including
 * character limits, formatting rules (allowed HTML, restricted characters),
 * and A+ content / enhanced brand content structuring. Returns compliance
 * status and a list of applied rules.
 *
 * This is a synchronous, pure rule-based service — no Bedrock invocation needed.
 *
 * Supported marketplaces: Amazon, Shopify, eBay.
 *
 * @module marketplace-adapter
 * @see Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import type { GenerationType, MarketplaceId, MarketplaceAdaptedContent } from '../types/generation.types';

// ---------------------------------------------------------------------------
// Character Limits
// ---------------------------------------------------------------------------

/**
 * Character limits per marketplace and content type.
 *
 * - Amazon: title 200, description 2000, bullets 500/each, keywords 250
 * - Shopify: title 255, description 5000, bullets unlimited, keywords unlimited
 * - eBay: title 80, description 4000, bullets 1000/each, keywords 1000
 */
const CHARACTER_LIMITS: Record<MarketplaceId, Partial<Record<GenerationType, number>>> = {
  amazon: {
    title: 200,
    description: 2000,
    bullets: 500,
    keywords: 250,
  },
  shopify: {
    title: 255,
    description: 5000,
    // bullets and keywords are unlimited for Shopify
  },
  ebay: {
    title: 80,
    description: 4000,
    bullets: 1000,
    keywords: 1000,
  },
};

// ---------------------------------------------------------------------------
// Formatting Rules
// ---------------------------------------------------------------------------

/**
 * Allowed HTML tags per marketplace.
 * Tags not in this list will be stripped.
 */
const ALLOWED_HTML_TAGS: Record<MarketplaceId, RegExp | null> = {
  // Amazon: limited HTML in descriptions (b, br, p, ul, ol, li), no HTML in titles
  amazon: /^(b|br|p|ul|ol|li|i|em|strong)$/i,
  // Shopify: allows rich HTML including headings, tables, media tags
  shopify: /^(h[1-6]|p|br|b|i|em|strong|u|ul|ol|li|a|img|table|thead|tbody|tr|td|th|div|span|blockquote|pre|code|hr|figure|figcaption|video|source)$/i,
  // eBay: limited HTML, no scripts or iframes
  ebay: /^(b|br|p|ul|ol|li|i|em|strong|u|a|img|table|tr|td|th|hr|h[1-6]|div|span|font)$/i,
};

/**
 * Restricted characters per marketplace.
 * Characters matching this pattern will be removed from content.
 */
const RESTRICTED_CHARACTERS: Record<MarketplaceId, RegExp> = {
  // Amazon: restrict special characters like ™, ©, ®, excessive punctuation (!!!), all caps abuse
  amazon: /[™©®]/g,
  // Shopify: minimal restrictions
  shopify: /[\x00-\x08\x0B\x0C\x0E-\x1F]/g,
  // eBay: restrict certain special characters
  ebay: /[<>]/g,
};

/**
 * Content types where HTML is NOT allowed (will be fully stripped).
 */
const NO_HTML_CONTENT_TYPES: Record<MarketplaceId, Set<GenerationType>> = {
  amazon: new Set(['title', 'keywords']),
  shopify: new Set(['title']),
  ebay: new Set(['title', 'keywords']),
};

// ---------------------------------------------------------------------------
// A+ Content / Enhanced Brand Content
// ---------------------------------------------------------------------------

/**
 * Content types eligible for A+ / enhanced brand content structuring on Amazon.
 */
const A_PLUS_ELIGIBLE_TYPES: Set<GenerationType> = new Set(['description']);

/**
 * A+ content module separator used to structure Amazon enhanced brand content.
 */
const A_PLUS_MODULE_SEPARATOR = '\n---\n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips HTML tags not in the allowed set for the given marketplace.
 *
 * @param content - The raw content string
 * @param marketplace - The target marketplace
 * @returns Content with disallowed HTML tags stripped
 */
function stripDisallowedHtml(content: string, marketplace: MarketplaceId): string {
  const allowedPattern = ALLOWED_HTML_TAGS[marketplace];

  if (!allowedPattern) {
    // No HTML allowed at all — strip everything
    return content.replace(/<\/?[^>]+(>|$)/g, '');
  }

  // Match all HTML tags and keep only allowed ones
  return content.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, (match, tagName: string) => {
    if (allowedPattern.test(tagName)) {
      return match;
    }
    return '';
  });
}

/**
 * Strips all HTML tags from content.
 *
 * @param content - The raw content string
 * @returns Content with all HTML tags removed
 */
function stripAllHtml(content: string): string {
  return content.replace(/<\/?[^>]+(>|$)/g, '');
}

/**
 * Removes restricted characters per marketplace rules.
 *
 * @param content - The content to sanitize
 * @param marketplace - The target marketplace
 * @returns Content with restricted characters removed
 */
function removeRestrictedCharacters(content: string, marketplace: MarketplaceId): string {
  const pattern = RESTRICTED_CHARACTERS[marketplace];
  return content.replace(pattern, '');
}

/**
 * Truncates content to the specified character limit.
 * Attempts to truncate at the nearest sentence boundary before the limit.
 *
 * @param content - The content to truncate
 * @param limit - The maximum character count
 * @returns An object with truncated content and whether truncation occurred
 */
function truncateToLimit(content: string, limit: number): { content: string; truncated: boolean } {
  if (content.length <= limit) {
    return { content, truncated: false };
  }

  const slice = content.slice(0, limit);

  // Try to truncate at the nearest sentence boundary
  const lastSentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('!\n'),
    slice.lastIndexOf('?\n'),
  );

  if (lastSentenceEnd > limit * 0.5) {
    // Only use sentence boundary if it preserves at least 50% of the limit
    return { content: slice.slice(0, lastSentenceEnd + 1).trimEnd(), truncated: true };
  }

  // Fall back to word boundary
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > limit * 0.5) {
    return { content: slice.slice(0, lastSpace).trimEnd(), truncated: true };
  }

  // Hard truncate at limit
  return { content: slice.trimEnd(), truncated: true };
}

/**
 * Structures content for Amazon A+ / enhanced brand content.
 * Splits content into modules separated by thematic breaks.
 *
 * @param content - The description content
 * @returns Structured content with A+ module separators
 */
function structureForAPlusContent(content: string): string {
  // Split on double newlines (paragraph breaks) to create modules
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length <= 1) {
    return content;
  }

  // Structure as A+ modules: each paragraph becomes a content module
  return paragraphs.join(A_PLUS_MODULE_SEPARATOR);
}

/**
 * Detects if content contains banned elements that make it non-compliant.
 * Banned elements include:
 * - Script tags
 * - Iframe tags
 * - Event handler attributes (onclick, onload, etc.)
 * - JavaScript: protocol links
 *
 * @param content - The content to check
 * @returns true if banned elements are found
 */
function containsBannedElements(content: string): boolean {
  const bannedPatterns = [
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    /<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi,
    /\bon\w+\s*=\s*["'][^"']*["']/gi,
    /javascript\s*:/gi,
  ];

  return bannedPatterns.some((pattern) => pattern.test(content));
}

// ---------------------------------------------------------------------------
// Marketplace Adapter
// ---------------------------------------------------------------------------

/**
 * Marketplace Adapter service that applies marketplace-specific rules to content.
 *
 * For any generated content, the adapter:
 * 1. Checks for banned elements (scripts, iframes, event handlers)
 * 2. Strips disallowed HTML tags per marketplace rules
 * 3. Removes restricted characters
 * 4. Enforces character limits (truncating if needed)
 * 5. Structures content for A+ / enhanced brand content when applicable (Amazon descriptions)
 * 6. Returns compliance status, warnings, and applied rules
 *
 * Compliance statuses:
 * - 'compliant': all rules pass, no issues
 * - 'warnings': content was truncated or minor issues found
 * - 'non_compliant': banned elements detected after processing, or exceeds hard limits
 *
 * @see Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */
export class MarketplaceAdapter {
  /**
   * Applies marketplace-specific rules to content.
   *
   * @param content - The raw content to adapt
   * @param marketplace - The target marketplace (amazon, shopify, ebay)
   * @param contentType - The generation type for context-specific rules
   * @returns MarketplaceAdaptedContent with adapted content, compliance status, warnings, and applied rules
   *
   * @see Requirements 8.1, 8.2, 8.3, 8.4, 8.5
   */
  apply(
    content: string,
    marketplace: MarketplaceId,
    contentType: GenerationType,
  ): MarketplaceAdaptedContent {
    const warnings: string[] = [];
    const appliedRules: string[] = [];
    let adaptedContent = content;
    let truncated = false;

    // -----------------------------------------------------------------------
    // 1. Check for banned elements (before any processing)
    // -----------------------------------------------------------------------
    const hasBannedElements = containsBannedElements(adaptedContent);
    if (hasBannedElements) {
      warnings.push(
        `Content contains banned elements (scripts, iframes, or event handlers) for ${marketplace}`,
      );
      appliedRules.push(`${marketplace}:banned-elements-check`);
    }

    // -----------------------------------------------------------------------
    // 2. Apply HTML formatting rules
    // -----------------------------------------------------------------------
    const noHtmlTypes = NO_HTML_CONTENT_TYPES[marketplace];
    if (noHtmlTypes.has(contentType)) {
      // Strip all HTML for content types that don't allow it
      const beforeHtml = adaptedContent;
      adaptedContent = stripAllHtml(adaptedContent);
      if (beforeHtml !== adaptedContent) {
        warnings.push(
          `HTML tags stripped from ${contentType} content (not allowed for ${marketplace})`,
        );
      }
      appliedRules.push(`${marketplace}:no-html-in-${contentType}`);
    } else {
      // Strip only disallowed HTML tags
      const beforeHtml = adaptedContent;
      adaptedContent = stripDisallowedHtml(adaptedContent, marketplace);
      if (beforeHtml !== adaptedContent) {
        warnings.push(
          `Disallowed HTML tags removed per ${marketplace} formatting rules`,
        );
      }
      appliedRules.push(`${marketplace}:html-tag-filtering`);
    }

    // -----------------------------------------------------------------------
    // 3. Remove restricted characters
    // -----------------------------------------------------------------------
    const beforeRestricted = adaptedContent;
    adaptedContent = removeRestrictedCharacters(adaptedContent, marketplace);
    if (beforeRestricted !== adaptedContent) {
      warnings.push(
        `Restricted characters removed per ${marketplace} rules`,
      );
    }
    appliedRules.push(`${marketplace}:restricted-characters`);

    // -----------------------------------------------------------------------
    // 4. Enforce character limits
    // -----------------------------------------------------------------------
    const limit = CHARACTER_LIMITS[marketplace][contentType];
    if (limit !== undefined) {
      const result = truncateToLimit(adaptedContent, limit);
      if (result.truncated) {
        truncated = true;
        warnings.push(
          `Content truncated from ${adaptedContent.length} to ${result.content.length} characters (${marketplace} ${contentType} limit: ${limit})`,
        );
      }
      adaptedContent = result.content;
      appliedRules.push(`${marketplace}:character-limit-${contentType}(${limit})`);
    }

    // -----------------------------------------------------------------------
    // 5. Structure for A+ content / enhanced brand content (Amazon descriptions)
    // -----------------------------------------------------------------------
    if (marketplace === 'amazon' && A_PLUS_ELIGIBLE_TYPES.has(contentType)) {
      adaptedContent = structureForAPlusContent(adaptedContent);
      appliedRules.push(`${marketplace}:a-plus-content-structure`);
    }

    // -----------------------------------------------------------------------
    // 6. Determine compliance status
    // -----------------------------------------------------------------------
    let complianceStatus: 'compliant' | 'warnings' | 'non_compliant';

    if (hasBannedElements) {
      // Banned elements = non-compliant regardless of other processing
      complianceStatus = 'non_compliant';
    } else if (truncated || warnings.length > 0) {
      complianceStatus = 'warnings';
    } else {
      complianceStatus = 'compliant';
    }

    return {
      content: adaptedContent,
      complianceStatus,
      warnings,
      truncated,
      appliedRules,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared MarketplaceAdapter instance */
export const marketplaceAdapter = new MarketplaceAdapter();
