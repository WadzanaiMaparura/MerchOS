/**
 * Step Functions task: CrawlUrl, crawls the supplier's site (robots.txt
 * respected) and extracts products from every page. Page HTML stays inside this
 * Lambda; only the extracted records are written for the next step.
 */
import { crawlPages, CrawlDisallowedError, initCrawlSession } from '../processors/url-crawler';
import { extractProductsFromHtml } from '../processors/html-extractor';
import type { ParsedRecord } from '../processors/file-parser';
import { finishParse, ImportInputError, markParsing } from './parse-common';
import { env, type StepOutput, type WorkflowInput } from './shared';

/** Keeps a crawl inside the Express workflow's 5-minute limit. */
const MAX_DEPTH = 2;

export async function handler(input: WorkflowInput): Promise<StepOutput> {
  await markParsing(input);
  const url = input.url ?? input.sourceReference;
  const startedAt = Date.now();

  let session;
  try {
    session = await initCrawlSession({
      url,
      importJobId: input.importJobId,
      tenantId: input.tenantId,
      supplierId: input.supplierId,
      config: { maxDepth: Math.max(0, Math.min(input.crawlDepth ?? 1, MAX_DEPTH)), resumable: false },
    });
  } catch (error) {
    if (error instanceof CrawlDisallowedError) throw new ImportInputError('CRAWL_DISALLOWED', error.message);
    throw error;
  }

  const crawled = await crawlPages(session);
  const config = {
    tenantId: input.tenantId,
    supplierId: input.supplierId,
    importJobId: input.importJobId,
    assetsBucket: env('ASSETS_BUCKET'),
  };

  const records: ParsedRecord[] = [];
  const seen = new Set<string>();
  let imagesDownloaded = 0;
  for (const page of crawled.crawledPages) {
    const { products } = await extractProductsFromHtml(page.html, page.url, config);
    for (const p of products) {
      // The same product often appears on several listing pages.
      const id = p.sku ? `sku:${p.sku}` : `url:${p.sourceUrl}|${p.title ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      imagesDownloaded += p.images.length;
      records.push({
        title: p.title,
        sku: p.sku,
        price: p.price,
        description: p.description,
        images: p.images,
        category: p.category,
        brand: p.brand,
        sourceRowIndex: records.length + 1,
        sourceSheet: p.sourceUrl,
      });
    }
  }

  return finishParse(input, { records }, {
    crawlStats: {
      pagesCrawled: crawled.crawledPages.length,
      pagesSkipped: Math.max(0, crawled.visitedUrls.length - crawled.crawledPages.length),
      productsExtracted: records.length,
      imagesDownloaded,
      errorsEncountered: 0,
      durationMs: Date.now() - startedAt,
    },
  });
}
