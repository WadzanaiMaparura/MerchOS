/**
 * Compliance Validator service for the Product Intelligence Engine.
 *
 * Validates generated content against marketplace-specific policies,
 * restricted terms, prohibited claims, trademark violations, and
 * policy-violating language using a combination of local rule checks
 * and Amazon Bedrock AI analysis.
 *
 * @module compliance-validator
 * @see Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import type {
  ProductData,
  MarketplaceId,
  ComplianceValidationResult,
} from '../types/generation.types';
import { BedrockClient } from './bedrock-client';
import { getModelConfig } from './model-config';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Input for compliance validation operations.
 */
export interface ComplianceValidationInput {
  /** The content to validate */
  content: string;
  /** Target marketplace whose policies to validate against */
  marketplace: MarketplaceId;
  /** Optional product data for additional context */
  productData?: ProductData;
}

/**
 * A single compliance violation detected during validation.
 */
export interface ComplianceViolation {
  /** Type of violation (e.g., "restricted_term", "prohibited_claim", "trademark", "policy_violation") */
  type: string;
  /** Severity level of the violation */
  severity: 'error' | 'warning';
  /** The text that triggered the violation */
  offendingText: string;
  /** Character span of the offending text in the original content */
  span: { start: number; end: number };
  /** Suggested replacement or fix */
  suggestedFix: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Known restricted terms across marketplaces that are prohibited or require caution.
 * These are checked locally before invoking Bedrock for deeper analysis.
 */
export const KNOWN_RESTRICTED_TERMS: {
  term: string;
  type: string;
  severity: 'error' | 'warning';
  suggestedFix: string;
  marketplaces: MarketplaceId[];
}[] = [
  {
    term: 'guaranteed',
    type: 'prohibited_claim',
    severity: 'error',
    suggestedFix: 'Remove absolute guarantee claim or rephrase as conditional',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: 'cure',
    type: 'prohibited_claim',
    severity: 'error',
    suggestedFix: 'Remove medical claim; use "may help support" instead',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: 'miracle',
    type: 'prohibited_claim',
    severity: 'error',
    suggestedFix: 'Remove exaggerated claim; use specific factual benefits',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: 'best in the world',
    type: 'prohibited_claim',
    severity: 'warning',
    suggestedFix: 'Remove superlative claim or provide substantiation',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: '#1 selling',
    type: 'prohibited_claim',
    severity: 'warning',
    suggestedFix: 'Remove unsubstantiated ranking claim or add verification source',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: 'FDA approved',
    type: 'restricted_term',
    severity: 'error',
    suggestedFix: 'Remove FDA approval claim unless product has actual FDA clearance',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: 'clinically proven',
    type: 'prohibited_claim',
    severity: 'warning',
    suggestedFix: 'Replace with "based on clinical studies" and cite source',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: 'risk-free',
    type: 'prohibited_claim',
    severity: 'warning',
    suggestedFix: 'Replace with specific return or refund policy details',
    marketplaces: ['amazon', 'ebay', 'shopify'],
  },
  {
    term: 'anti-aging',
    type: 'restricted_term',
    severity: 'warning',
    suggestedFix: 'Replace with "helps reduce appearance of fine lines"',
    marketplaces: ['amazon'],
  },
  {
    term: 'weight loss',
    type: 'restricted_term',
    severity: 'warning',
    suggestedFix: 'Replace with "supports healthy weight management"',
    marketplaces: ['amazon'],
  },
];

/**
 * Known trademarks that are protected and must not be used without authorization.
 * Checked locally before Bedrock verification.
 */
export const KNOWN_TRADEMARKS: {
  term: string;
  owner: string;
  suggestedFix: string;
}[] = [
  { term: 'iPhone', owner: 'Apple Inc.', suggestedFix: 'Use "compatible with iPhone" instead of implying affiliation' },
  { term: 'iPad', owner: 'Apple Inc.', suggestedFix: 'Use "compatible with iPad" instead of implying affiliation' },
  { term: 'AirPods', owner: 'Apple Inc.', suggestedFix: 'Use "compatible with AirPods" instead of implying affiliation' },
  { term: 'Samsung Galaxy', owner: 'Samsung Electronics', suggestedFix: 'Use "compatible with Samsung Galaxy" instead of implying affiliation' },
  { term: 'PlayStation', owner: 'Sony Interactive Entertainment', suggestedFix: 'Use "compatible with PlayStation" instead of implying affiliation' },
  { term: 'Xbox', owner: 'Microsoft Corporation', suggestedFix: 'Use "compatible with Xbox" instead of implying affiliation' },
  { term: 'Nintendo Switch', owner: 'Nintendo Co.', suggestedFix: 'Use "compatible with Nintendo Switch" instead of implying affiliation' },
  { term: 'Bluetooth', owner: 'Bluetooth SIG', suggestedFix: 'Ensure Bluetooth certification or use "wireless" instead' },
  { term: 'Teflon', owner: 'Chemours Company', suggestedFix: 'Use "non-stick coating" instead unless officially licensed' },
  { term: 'Velcro', owner: 'Velcro Companies', suggestedFix: 'Use "hook-and-loop fastener" instead' },
  { term: 'Band-Aid', owner: 'Johnson & Johnson', suggestedFix: 'Use "adhesive bandage" instead' },
  { term: 'Jacuzzi', owner: 'Jacuzzi Inc.', suggestedFix: 'Use "hot tub" or "whirlpool bath" instead' },
];

/**
 * Compliance score penalties by severity.
 */
const SEVERITY_PENALTIES: Record<'error' | 'warning', number> = {
  error: 0.25,
  warning: 0.1,
};

// ---------------------------------------------------------------------------
// Compliance Validator Class
// ---------------------------------------------------------------------------

/**
 * Compliance Validator service that checks content against marketplace policies
 * using local rule checks and Amazon Bedrock AI analysis.
 *
 * Validation flow:
 * 1. Check content against KNOWN_RESTRICTED_TERMS (local)
 * 2. Check content against KNOWN_TRADEMARKS (local)
 * 3. Invoke Bedrock for deeper policy analysis (marketplace-specific)
 * 4. Merge all violations, compute compliance score and status
 * 5. Generate corrected content when status is 'fail'
 *
 * Uses Claude 3 Sonnet (via `getModelConfig('compliance')`) for policy reasoning
 * due to the complexity of compliance analysis.
 *
 * @see Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */
export class ComplianceValidator {
  private readonly bedrockClient: BedrockClient;

  /**
   * Creates a new ComplianceValidator instance.
   *
   * @param bedrockClient - Optional Bedrock client instance (defaults to a new BedrockClient)
   */
  constructor(bedrockClient?: BedrockClient) {
    this.bedrockClient = bedrockClient ?? new BedrockClient();
  }

  /**
   * Validates content against marketplace-specific policies.
   *
   * Flow:
   * 1. Checks content against known restricted terms for the marketplace
   * 2. Checks content against known trademarks
   * 3. Invokes Bedrock for AI-powered deeper policy analysis
   * 4. Merges all detected violations
   * 5. Calculates compliance score based on violation severities
   * 6. Determines overall status (pass, fail, warnings_only)
   * 7. Generates corrected content when status is 'fail'
   *
   * @param request - The compliance validation input with content, marketplace, and optional product data
   * @returns A ComplianceValidationResult with status, score, violations, and optional corrected content
   * @throws BedrockUnavailableError if Bedrock invocation fails after all retries
   *
   * @see Requirement 10.1 — checks content against marketplace policies
   * @see Requirement 10.2 — detects restricted terms, prohibited claims, policy-violating language
   * @see Requirement 10.3 — returns violations with type, severity, offending text span, suggested fix
   * @see Requirement 10.4 — checks for trademark violations
   * @see Requirement 10.5 — returns compliance status and score (0-1)
   * @see Requirement 10.6 — provides corrected content when status is 'fail'
   */
  async validate(
    request: ComplianceValidationInput,
  ): Promise<ComplianceValidationResult> {
    const { content, marketplace, productData } = request;

    // Step 1: Local restricted term checks
    const restrictedTermViolations = this.checkRestrictedTerms(content, marketplace);

    // Step 2: Local trademark checks
    const trademarkViolations = this.checkTrademarks(content);

    // Step 3: AI-powered deep policy analysis via Bedrock
    const aiViolations = await this.analyzeWithBedrock(content, marketplace, productData);

    // Step 4: Merge all violations (deduplicate by span overlap)
    const allViolations = this.mergeViolations([
      ...restrictedTermViolations,
      ...trademarkViolations,
      ...aiViolations,
    ]);

    // Step 5: Calculate compliance score
    const complianceScore = this.calculateComplianceScore(allViolations);

    // Step 6: Determine overall status
    const status = this.determineStatus(allViolations);

    // Step 7: Generate corrected content when status is 'fail'
    if (status === 'fail') {
      const correctedContent = this.generateCorrectedContent(content, allViolations);
      return {
        status,
        complianceScore,
        violations: allViolations,
        correctedContent,
      };
    }

    return {
      status,
      complianceScore,
      violations: allViolations,
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Checks content against known restricted terms for the specified marketplace.
   *
   * Performs case-insensitive matching against the KNOWN_RESTRICTED_TERMS list,
   * filtered by the target marketplace. Returns violations with accurate span
   * positions in the original content.
   *
   * @param content - The content to check
   * @param marketplace - The target marketplace to filter restrictions
   * @returns Array of violations for detected restricted terms
   */
  private checkRestrictedTerms(
    content: string,
    marketplace: MarketplaceId,
  ): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];
    const contentLower = content.toLowerCase();

    for (const restriction of KNOWN_RESTRICTED_TERMS) {
      if (!restriction.marketplaces.includes(marketplace)) {
        continue;
      }

      const termLower = restriction.term.toLowerCase();
      let searchStart = 0;

      while (true) {
        const index = contentLower.indexOf(termLower, searchStart);
        if (index === -1) break;

        const end = index + restriction.term.length;
        violations.push({
          type: restriction.type,
          severity: restriction.severity,
          offendingText: content.substring(index, end),
          span: { start: index, end },
          suggestedFix: restriction.suggestedFix,
        });

        searchStart = end;
      }
    }

    return violations;
  }

  /**
   * Checks content against known trademarks.
   *
   * Performs case-insensitive matching against the KNOWN_TRADEMARKS list.
   * Trademark violations are always severity 'warning' unless the usage
   * implies affiliation or endorsement.
   *
   * @param content - The content to check for trademark usage
   * @returns Array of violations for detected trademark usage
   */
  private checkTrademarks(content: string): ComplianceViolation[] {
    const violations: ComplianceViolation[] = [];
    const contentLower = content.toLowerCase();

    for (const trademark of KNOWN_TRADEMARKS) {
      const termLower = trademark.term.toLowerCase();
      let searchStart = 0;

      while (true) {
        const index = contentLower.indexOf(termLower, searchStart);
        if (index === -1) break;

        const end = index + trademark.term.length;
        violations.push({
          type: 'trademark',
          severity: 'warning',
          offendingText: content.substring(index, end),
          span: { start: index, end },
          suggestedFix: trademark.suggestedFix,
        });

        searchStart = end;
      }
    }

    return violations;
  }

  /**
   * Invokes Bedrock for deeper marketplace-specific policy analysis.
   *
   * Sends the content and marketplace context to Claude Sonnet for analysis
   * of policy violations that go beyond simple term matching, including:
   * - Misleading or deceptive language
   * - Unsubstantiated health/safety claims
   * - Marketplace-specific formatting violations
   * - Prohibited pricing language
   *
   * @param content - The content to analyze
   * @param marketplace - The target marketplace
   * @param productData - Optional product context
   * @returns Array of AI-detected violations
   */
  private async analyzeWithBedrock(
    content: string,
    marketplace: MarketplaceId,
    productData?: ProductData,
  ): Promise<ComplianceViolation[]> {
    const modelConfig = getModelConfig('compliance');
    const prompt = this.buildPrompt(content, marketplace, productData);

    const response = await this.bedrockClient.invoke({
      modelId: modelConfig.modelId,
      prompt,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    });

    return this.parseBedrockResponse(response.content, content);
  }

  /**
   * Builds the compliance analysis prompt for Bedrock invocation.
   *
   * @param content - The content to validate
   * @param marketplace - The target marketplace
   * @param productData - Optional product context
   * @returns The formatted prompt string
   */
  private buildPrompt(
    content: string,
    marketplace: MarketplaceId,
    productData?: ProductData,
  ): string {
    const contextParts: string[] = [];

    if (productData?.name) {
      contextParts.push(`Product Name: ${productData.name}`);
    }
    if (productData?.category) {
      contextParts.push(`Category: ${productData.category}`);
    }
    if (productData?.brand) {
      contextParts.push(`Brand: ${productData.brand}`);
    }

    const productContext = contextParts.length > 0
      ? `\n\nProduct Context:\n${contextParts.join('\n')}`
      : '';

    const marketplaceGuidelines = this.getMarketplaceGuidelines(marketplace);

    return `You are a marketplace content compliance expert. Analyze the following product listing content for compliance violations against ${marketplace} marketplace policies.

Content to analyze:
"${content}"${productContext}

Marketplace Guidelines for ${marketplace}:
${marketplaceGuidelines}

Check for:
1. Prohibited claims (health, safety, guarantee claims without substantiation)
2. Misleading or deceptive language
3. Policy-violating content (offensive, discriminatory, or inappropriate language)
4. Pricing-related violations (fake urgency, bait-and-switch language)
5. Format and structural violations specific to ${marketplace}

For each violation found, provide:
- "type": one of "prohibited_claim", "misleading_language", "policy_violation", "pricing_violation", "format_violation"
- "severity": "error" for must-fix violations, "warning" for recommended fixes
- "offendingText": the exact text that violates the policy (must be a substring of the content)
- "startIndex": the character index where the offending text starts in the original content
- "endIndex": the character index where the offending text ends in the original content
- "suggestedFix": a specific suggestion to resolve the violation

Respond ONLY with a JSON array of violation objects. If no violations are found, respond with an empty array: []

Example:
[{"type": "prohibited_claim", "severity": "error", "offendingText": "guaranteed to cure", "startIndex": 15, "endIndex": 33, "suggestedFix": "Replace with 'designed to help support'"}]`;
  }

  /**
   * Returns marketplace-specific compliance guidelines for prompt context.
   *
   * @param marketplace - The target marketplace
   * @returns Guidelines text for the specified marketplace
   */
  private getMarketplaceGuidelines(marketplace: MarketplaceId): string {
    switch (marketplace) {
      case 'amazon':
        return `- No unsubstantiated health or medical claims
- No guaranteed results without evidence
- No time-sensitive pressure language (limited time, act now)
- No competitor disparagement
- No pricing references in product descriptions
- No external website URLs
- No requests for positive reviews
- Title must not contain promotional language (sale, discount, free shipping)`;
      case 'shopify':
        return `- No false advertising or misleading claims
- No prohibited product categories content
- No hate speech or discriminatory language
- Must comply with consumer protection regulations
- No unverified environmental claims (greenwashing)
- No fake endorsements or testimonials`;
      case 'ebay':
        return `- No keyword stuffing or irrelevant keywords
- No misleading item condition descriptions
- No link to external sites for transaction completion
- No "best offer" pressure language in descriptions
- No stock photos misrepresented as actual product
- No unverified brand affiliation claims`;
      default:
        return '- Follow general e-commerce content guidelines';
    }
  }

  /**
   * Parses the Bedrock AI response into structured violation objects.
   *
   * Validates each violation entry and computes accurate span positions
   * by locating the offending text within the original content.
   *
   * @param responseContent - The raw Bedrock model response
   * @param originalContent - The original content being validated (for span verification)
   * @returns Array of validated compliance violations
   */
  private parseBedrockResponse(
    responseContent: string,
    originalContent: string,
  ): ComplianceViolation[] {
    try {
      const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed: unknown[] = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object',
        )
        .filter((item) =>
          typeof item['type'] === 'string' &&
          item['type'] !== '' &&
          (item['severity'] === 'error' || item['severity'] === 'warning') &&
          typeof item['offendingText'] === 'string' &&
          item['offendingText'] !== '' &&
          typeof item['suggestedFix'] === 'string' &&
          item['suggestedFix'] !== '',
        )
        .map((item) => {
          const offendingText = item['offendingText'] as string;
          const type = item['type'] as string;
          const severity = item['severity'] as 'error' | 'warning';
          const suggestedFix = item['suggestedFix'] as string;

          // Compute accurate span by locating the offending text in the original content
          const span = this.computeSpan(originalContent, offendingText, item);

          return {
            type,
            severity,
            offendingText,
            span,
            suggestedFix,
          };
        })
        .filter((v) => v.span.start < v.span.end);
    } catch {
      return [];
    }
  }

  /**
   * Computes the span (start, end) for an offending text within the original content.
   *
   * Prefers the model-provided indices if they are valid (text at those positions matches).
   * Falls back to searching for the offending text in the content.
   *
   * @param originalContent - The original content string
   * @param offendingText - The text that violates the policy
   * @param item - The parsed violation item (may contain startIndex/endIndex)
   * @returns The span with start and end positions
   */
  private computeSpan(
    originalContent: string,
    offendingText: string,
    item: Record<string, unknown>,
  ): { start: number; end: number } {
    // Try model-provided indices first
    const startIndex = item['startIndex'];
    const endIndex = item['endIndex'];

    if (
      typeof startIndex === 'number' &&
      typeof endIndex === 'number' &&
      startIndex >= 0 &&
      endIndex > startIndex &&
      endIndex <= originalContent.length
    ) {
      const textAtPosition = originalContent.substring(startIndex, endIndex);
      if (textAtPosition === offendingText) {
        return { start: startIndex, end: endIndex };
      }
    }

    // Fall back to searching for the text in the content
    const index = originalContent.indexOf(offendingText);
    if (index !== -1) {
      return { start: index, end: index + offendingText.length };
    }

    // Case-insensitive fallback
    const lowerIndex = originalContent.toLowerCase().indexOf(offendingText.toLowerCase());
    if (lowerIndex !== -1) {
      return { start: lowerIndex, end: lowerIndex + offendingText.length };
    }

    // Last resort: use model indices if they are at least structurally valid
    if (
      typeof startIndex === 'number' &&
      typeof endIndex === 'number' &&
      startIndex >= 0 &&
      endIndex > startIndex
    ) {
      return { start: startIndex, end: endIndex };
    }

    // If nothing works, mark as invalid (will be filtered out)
    return { start: 0, end: 0 };
  }

  /**
   * Merges violations from multiple sources, deduplicating by span overlap.
   *
   * When two violations have overlapping spans, the one with higher severity
   * is kept (error > warning).
   *
   * @param violations - Array of all detected violations
   * @returns Deduplicated array of violations
   */
  private mergeViolations(violations: ComplianceViolation[]): ComplianceViolation[] {
    if (violations.length === 0) return [];

    // Sort by span start position
    const sorted = [...violations].sort((a, b) => a.span.start - b.span.start);
    const merged: ComplianceViolation[] = [];

    for (const violation of sorted) {
      const existing = merged.find(
        (v) =>
          v.span.start === violation.span.start &&
          v.span.end === violation.span.end &&
          v.type === violation.type,
      );

      if (existing) {
        // Keep the higher severity one
        if (violation.severity === 'error' && existing.severity === 'warning') {
          const index = merged.indexOf(existing);
          merged[index] = violation;
        }
      } else {
        merged.push(violation);
      }
    }

    return merged;
  }

  /**
   * Calculates the compliance score based on detected violations.
   *
   * Starts at 1.0 and applies penalties per violation:
   * - error: -0.25 per violation
   * - warning: -0.10 per violation
   *
   * Score is clamped to [0.0, 1.0].
   *
   * @param violations - Array of detected violations
   * @returns Compliance score between 0 and 1
   */
  private calculateComplianceScore(violations: ComplianceViolation[]): number {
    if (violations.length === 0) return 1.0;

    let score = 1.0;
    for (const violation of violations) {
      score -= SEVERITY_PENALTIES[violation.severity];
    }

    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Determines the overall compliance status based on violations.
   *
   * - 'pass': No violations detected
   * - 'warnings_only': Only warning-severity violations detected
   * - 'fail': At least one error-severity violation detected
   *
   * @param violations - Array of detected violations
   * @returns The compliance status
   */
  private determineStatus(
    violations: ComplianceViolation[],
  ): 'pass' | 'fail' | 'warnings_only' {
    if (violations.length === 0) return 'pass';

    const hasErrors = violations.some((v) => v.severity === 'error');
    if (hasErrors) return 'fail';

    return 'warnings_only';
  }

  /**
   * Generates corrected content by applying suggested fixes to the original content.
   *
   * Replaces offending text spans with their suggested fixes, processing from
   * the end of the content backwards to maintain valid span positions.
   *
   * @param content - The original content
   * @param violations - The violations with suggested fixes
   * @returns The corrected content with violations resolved
   */
  private generateCorrectedContent(
    content: string,
    violations: ComplianceViolation[],
  ): string {
    // Sort violations by span start descending so we can replace from end to start
    // without invalidating earlier span positions
    const sortedViolations = [...violations]
      .filter((v) => v.severity === 'error')
      .sort((a, b) => b.span.start - a.span.start);

    let corrected = content;

    for (const violation of sortedViolations) {
      const { start, end } = violation.span;

      if (start >= 0 && end <= corrected.length && start < end) {
        corrected =
          corrected.substring(0, start) +
          violation.suggestedFix +
          corrected.substring(end);
      }
    }

    return corrected;
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared ComplianceValidator instance */
export const complianceValidator = new ComplianceValidator();
