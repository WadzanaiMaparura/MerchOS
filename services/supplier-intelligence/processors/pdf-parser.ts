/**
 * PDF Parser Lambda — Extracts product records from PDF documents using text analysis heuristics.
 * Requirements: 2.3
 *
 * Responsibilities:
 * - Extract text content from PDF documents using pdf-parse
 * - Apply heuristics to identify product records from text blocks
 * - Detect SKU codes, prices, and product names using pattern matching
 * - Return an array of parsed records with source page indices for traceability
 */

import pdf from 'pdf-parse';
import type { ParsedRecord, FileParseResult } from './file-parser';

// ---------------------------------------------------------------------------
// Heuristic Patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns for detecting product-related data in text.
 */
const PATTERNS = {
  /**
   * SKU patterns: alphanumeric codes with dashes/dots, typically 4-20 chars.
   * Examples: SKU-12345, ABC-001, PROD.2024.001, WH-BLK-XL
   */
  sku: /\b(?:SKU|sku|Item|ITEM|Art|ART|Ref|REF|Code|CODE|Part|PART)[#:\s.-]*([A-Z0-9][A-Z0-9\-._]{2,19})\b/,

  /**
   * Standalone SKU-like codes: uppercase alphanumeric with at least one dash or dot, 4-20 chars.
   * Catches SKUs that aren't prefixed with a label.
   */
  standalonesku: /\b([A-Z]{1,5}[-.](?:[A-Z0-9]+[-.]?){1,5}[A-Z0-9]+)\b/,

  /**
   * Price patterns: currency symbol followed by numbers (with optional thousand separators and decimals).
   * Supports: $, €, £, ¥
   */
  price: /(?:[$€£¥])\s*(\d{1,3}(?:[,. ]\d{3})*(?:[.,]\d{1,2})?)\b|\b(\d{1,3}(?:[,. ]\d{3})*(?:[.,]\d{1,2})?)\s*(?:[$€£¥])/,

  /**
   * Numeric price with labels: "Price:", "Cost:", "RRP:", etc.
   */
  labelledPrice: /\b(?:Price|PRICE|Cost|COST|RRP|MRP|MSRP|Unit Price)[:\s]*[$€£¥]?\s*(\d{1,3}(?:[,. ]\d{3})*(?:[.,]\d{1,2})?)/i,
};

// ---------------------------------------------------------------------------
// Text Block Analysis
// ---------------------------------------------------------------------------

/**
 * Represents a block of text from a single PDF page.
 */
interface PageTextBlock {
  text: string;
  pageIndex: number;
}

/**
 * A candidate product extracted from a text block via heuristic analysis.
 */
interface ProductCandidate {
  title?: string;
  sku?: string;
  price?: string;
  description?: string;
  pageIndex: number;
}

/**
 * Extract the raw price string from a line of text.
 */
function extractPrice(line: string): string | undefined {
  const labelledMatch = line.match(PATTERNS.labelledPrice);
  if (labelledMatch?.[1]) {
    return labelledMatch[1];
  }

  const priceMatch = line.match(PATTERNS.price);
  if (priceMatch) {
    // The full match includes the currency symbol — return just the number portion
    const fullMatch = priceMatch[0].trim();
    return fullMatch;
  }

  return undefined;
}

/**
 * Extract a SKU code from a line of text.
 */
function extractSku(line: string): string | undefined {
  const labelledMatch = line.match(PATTERNS.sku);
  if (labelledMatch?.[1]) {
    return labelledMatch[1];
  }

  const standaloneMatch = line.match(PATTERNS.standalonesku);
  if (standaloneMatch?.[1]) {
    return standaloneMatch[1];
  }

  return undefined;
}

/**
 * Determine if a line looks like a product title.
 * Heuristic: a non-empty line that is relatively short (5-150 chars),
 * doesn't look like a header/footer/page number, and has some capitalization.
 */
function isLikelyTitle(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 150) return false;

  // Skip lines that are just numbers (page numbers)
  if (/^\d+$/.test(trimmed)) return false;

  // Skip common header/footer patterns
  if (/^(page|copyright|all rights|www\.|http|tel:|fax:|email:)/i.test(trimmed)) return false;

  // Skip lines that are just punctuation or symbols
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) return false;

  // A title should have at least 2 word characters
  const wordChars = trimmed.replace(/[^a-zA-Z0-9]/g, '');
  if (wordChars.length < 3) return false;

  return true;
}

/**
 * Split page text into logical blocks separated by blank lines or significant whitespace.
 */
function splitIntoBlocks(pageText: string): string[] {
  // Split on double newlines or lines of whitespace/dashes/underscores (common separators in PDFs)
  return pageText
    .split(/\n(?:\s*\n)+|\n[-_=]{3,}\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * Attempt to extract a product candidate from a text block.
 * A valid candidate must have at least a SKU or price (indicators of product data).
 */
function extractProductFromBlock(block: string, pageIndex: number): ProductCandidate | null {
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length === 0) return null;

  let sku: string | undefined;
  let price: string | undefined;
  let title: string | undefined;
  let descriptionLines: string[] = [];

  for (const line of lines) {
    // Try to extract SKU
    if (!sku) {
      const extractedSku = extractSku(line);
      if (extractedSku) {
        sku = extractedSku;
        continue;
      }
    }

    // Try to extract price
    if (!price) {
      const extractedPrice = extractPrice(line);
      if (extractedPrice) {
        price = extractedPrice;
        continue;
      }
    }

    // Try to identify title (first plausible title line)
    if (!title && isLikelyTitle(line)) {
      title = line;
      continue;
    }

    // Everything else is potential description
    if (line.length > 2) {
      descriptionLines.push(line);
    }
  }

  // A product candidate requires at least a SKU or price to be considered product data
  if (!sku && !price) {
    return null;
  }

  return {
    title,
    sku,
    price,
    description: descriptionLines.length > 0 ? descriptionLines.join(' ') : undefined,
    pageIndex,
  };
}

/**
 * Attempt to parse tabular content where products are in rows.
 * Detects table-like structures where lines have consistent column patterns.
 */
function extractProductsFromTable(pageText: string, pageIndex: number): ProductCandidate[] {
  const lines = pageText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const candidates: ProductCandidate[] = [];

  for (const line of lines) {
    const sku = extractSku(line);
    const price = extractPrice(line);

    // If a single line has both SKU and price, it's likely a table row
    if (sku && price) {
      // Try to extract title: the text remaining after removing SKU and price patterns
      let remaining = line
        .replace(PATTERNS.sku, '')
        .replace(PATTERNS.standalonesku, '')
        .replace(PATTERNS.price, '')
        .replace(PATTERNS.labelledPrice, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      // Clean up leftover labels
      remaining = remaining.replace(/^[:\s-]+|[:\s-]+$/g, '').trim();

      const title = remaining.length >= 3 ? remaining : undefined;

      candidates.push({ title, sku, price, pageIndex });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Main PDF Parser
// ---------------------------------------------------------------------------

/**
 * Parse a PDF document buffer and extract product records using text analysis heuristics.
 *
 * The parser works in two modes:
 * 1. Table detection — identifies rows where SKU + price appear on the same line
 * 2. Block extraction — splits text into logical blocks and extracts product data from each
 *
 * @param content - Raw PDF file content as a Buffer
 * @returns FileParseResult with parsed product records and metadata
 */
export async function parsePdf(content: Buffer): Promise<FileParseResult> {
  const pdfData = await pdf(content);

  if (!pdfData.text || pdfData.text.trim().length === 0) {
    return {
      records: [],
      totalRows: 0,
      detectedHeaders: [],
    };
  }

  // pdf-parse provides numpages and text. We need per-page text for traceability.
  // pdf-parse doesn't expose per-page text directly in its default render,
  // so we re-parse using the custom pagerender option.
  const pageTexts: PageTextBlock[] = [];

  const pdfDataWithPages = await pdf(content, {
    pagerender: (pageData: any) => {
      return pageData.getTextContent().then((textContent: any) => {
        const strings = textContent.items.map((item: any) => item.str).join(' ');
        return strings;
      });
    },
  });

  // Split the full text by form feeds (page separators) if available,
  // otherwise treat as single page
  const fullText = pdfDataWithPages.text;
  const pageCount = pdfDataWithPages.numpages;

  // pdf-parse concatenates pages with newlines. We use a heuristic to split by page count.
  // When pagerender is used, pages are typically separated by \n\n in the output.
  const rawPages = splitTextIntoPages(fullText, pageCount);

  for (let i = 0; i < rawPages.length; i++) {
    pageTexts.push({ text: rawPages[i], pageIndex: i });
  }

  // Extract products using both methods
  const allCandidates: ProductCandidate[] = [];

  for (const page of pageTexts) {
    // Method 1: Table row detection (lines with both SKU and price)
    const tableProducts = extractProductsFromTable(page.text, page.pageIndex);
    allCandidates.push(...tableProducts);

    // Method 2: Block-based extraction (for non-tabular layouts)
    if (tableProducts.length === 0) {
      const blocks = splitIntoBlocks(page.text);
      for (const block of blocks) {
        const candidate = extractProductFromBlock(block, page.pageIndex);
        if (candidate) {
          allCandidates.push(candidate);
        }
      }
    }
  }

  // Deduplicate: if a SKU appears in both table and block extraction, prefer the one with more data
  const deduped = deduplicateCandidates(allCandidates);

  // Convert candidates to ParsedRecord format
  const records: ParsedRecord[] = deduped.map((candidate, index) => ({
    title: candidate.title,
    sku: candidate.sku,
    price: candidate.price,
    description: candidate.description,
    images: [],
    sourceRowIndex: index + 1, // 1-based index for consistency with CSV/Excel
    sourceSheet: `page-${candidate.pageIndex + 1}`, // Reuse sourceSheet field for page reference
  }));

  return {
    records,
    totalRows: records.length,
    detectedHeaders: ['title', 'sku', 'price', 'description'],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split full PDF text into per-page chunks.
 * Uses form-feed characters if present, otherwise splits heuristically by page count.
 */
function splitTextIntoPages(fullText: string, pageCount: number): string[] {
  // Check for form feed characters (common page separator)
  if (fullText.includes('\f')) {
    return fullText.split('\f').filter((p) => p.trim().length > 0);
  }

  // If only one page, return the full text
  if (pageCount <= 1) {
    return [fullText];
  }

  // Heuristic split: divide text roughly evenly across pages
  // This is an approximation — pdf-parse doesn't guarantee clean page boundaries
  const lines = fullText.split('\n');
  const linesPerPage = Math.ceil(lines.length / pageCount);
  const pages: string[] = [];

  for (let i = 0; i < pageCount; i++) {
    const start = i * linesPerPage;
    const end = Math.min(start + linesPerPage, lines.length);
    const pageText = lines.slice(start, end).join('\n');
    if (pageText.trim().length > 0) {
      pages.push(pageText);
    }
  }

  return pages.length > 0 ? pages : [fullText];
}

/**
 * Deduplicate product candidates by SKU. When the same SKU is found multiple times,
 * keep the candidate with the most populated fields.
 */
function deduplicateCandidates(candidates: ProductCandidate[]): ProductCandidate[] {
  const bysku = new Map<string, ProductCandidate>();
  const nosku: ProductCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.sku) {
      nosku.push(candidate);
      continue;
    }

    const existing = bysku.get(candidate.sku);
    if (!existing) {
      bysku.set(candidate.sku, candidate);
    } else {
      // Keep the one with more fields populated
      const existingScore = fieldCount(existing);
      const newScore = fieldCount(candidate);
      if (newScore > existingScore) {
        bysku.set(candidate.sku, candidate);
      }
    }
  }

  return [...bysku.values(), ...nosku];
}

/**
 * Count the number of populated fields on a candidate (for deduplication scoring).
 */
function fieldCount(candidate: ProductCandidate): number {
  let count = 0;
  if (candidate.title) count++;
  if (candidate.sku) count++;
  if (candidate.price) count++;
  if (candidate.description) count++;
  return count;
}
