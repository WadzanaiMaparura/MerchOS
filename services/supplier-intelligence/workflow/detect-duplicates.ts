/**
 * Step Functions task: DetectDuplicates. Applies the supplier's duplicate
 * strategy (SKIP / MERGE / CREATE_FLAGGED) to every valid record, against both
 * existing products and earlier rows of the same import.
 *
 * Product IDs are assigned HERE (not in the persister) so a retried persist step
 * rewrites the same items instead of creating a second copy of each product.
 */
import { randomUUID } from 'node:crypto';
import { GetCommand } from '@aws-sdk/lib-dynamodb';

import { detectDuplicates } from '../processors/duplicate-detector';
import type { ProductToPersist } from '../processors/product-persister';
import type { DuplicateStrategy, ImportMetadata } from '../types';
import type { ValidatedWork } from './validate';
import { env, getDdb, readWork, requireResult, setJobFields, writeWork, type StepOutput, type WorkflowInput } from './shared';

/** Parallel SKU lookups per batch (keeps well under on-demand throttling). */
const LOOKUP_CONCURRENCY = 10;

export interface MergeUpdate {
  existingProductId: string;
  record: ProductToPersist['record'];
}

export interface DedupedWork {
  totalExtracted: number;
  validationFailed: number;
  duplicates: number;
  skipped: number;
  create: ProductToPersist[];
  merge: MergeUpdate[];
}

async function supplierStrategy(tenantId: string, supplierId: string): Promise<DuplicateStrategy> {
  const res = await getDdb().send(new GetCommand({
    TableName: env('SUPPLIERS_TABLE'),
    Key: { PK: `TENANT#${tenantId}`, SK: `SUPPLIER#${supplierId}` },
    ProjectionExpression: 'duplicateStrategy',
  }));
  const s = res.Item?.['duplicateStrategy'];
  // The create-supplier schema requires a strategy; SKIP is the safe fallback
  // (never overwrites or duplicates anything).
  return s === 'MERGE' || s === 'CREATE_FLAGGED' || s === 'SKIP' ? s : 'SKIP';
}

export async function handler(input: WorkflowInput): Promise<StepOutput> {
  const validatedRef = requireResult(input.validationResult, 'validation');
  const validated = await readWork<ValidatedWork>(validatedRef.key);
  const strategy = await supplierStrategy(input.tenantId, input.supplierId);
  const importedAt = new Date().toISOString();

  const valid = validated.records.filter((r) => r.status === 'VALID');
  const work: DedupedWork = {
    totalExtracted: validated.totalExtracted,
    validationFailed: validated.records.length - valid.length,
    duplicates: 0,
    skipped: 0,
    create: [],
    merge: [],
  };

  // Existing-product matches (parallel, bounded).
  const actions = new Array<Awaited<ReturnType<typeof detectDuplicates>>>(valid.length);
  for (let i = 0; i < valid.length; i += LOOKUP_CONCURRENCY) {
    const slice = valid.slice(i, i + LOOKUP_CONCURRENCY);
    const res = await Promise.all(slice.map((r) => detectDuplicates({
      tenantId: input.tenantId,
      supplierId: input.supplierId,
      duplicateStrategy: strategy,
      record: { sku: r.record.sku, title: (r.record as { title?: string }).title },
    })));
    res.forEach((a, j) => { actions[i + j] = a; });
  }

  // Rows earlier in this same file with the same SKU (sequential, order matters).
  const firstIdBySku = new Map<string, string>();

  valid.forEach((r, i) => {
    const action = actions[i]!;
    const sku = (r.record.sku ?? '').trim();
    const meta: ImportMetadata = {
      sourceImportJobId: input.importJobId,
      sourceSupplierId: input.supplierId,
      sourceType: input.sourceType,
      importedAt,
      ...(r.meta?.ocrConfidence !== undefined ? { ocrConfidence: r.meta.ocrConfidence } : {}),
      ...(r.meta?.flaggedForReview ? { flaggedForReview: true } : {}),
    };

    if (action.action !== 'create') {
      work.duplicates++;
      if (action.action === 'skip') { work.skipped++; return; }
      if (action.action === 'merge') { work.merge.push({ existingProductId: action.existingProductId, record: r.record }); return; }
      work.create.push({ record: r.record, productId: randomUUID(), importMetadata: { ...meta, duplicateOf: action.duplicateOf } });
      return;
    }

    const earlier = sku ? firstIdBySku.get(sku) : undefined;
    if (earlier) {
      work.duplicates++;
      if (strategy === 'CREATE_FLAGGED') {
        work.create.push({ record: r.record, productId: randomUUID(), importMetadata: { ...meta, duplicateOf: earlier } });
      } else {
        // SKIP, and MERGE within one file: the first row wins.
        work.skipped++;
      }
      return;
    }

    const productId = randomUUID();
    if (sku) firstIdBySku.set(sku, productId);
    work.create.push({ record: r.record, productId, importMetadata: meta });
  });

  await setJobFields(input, {
    progress: {
      percentage: 70,
      currentStep: `${work.duplicates} duplicate(s) found (${strategy.toLowerCase().replace('_', ' ')})`,
    },
  });
  const key = await writeWork(input, 'deduplicated', work);
  return { key, count: work.create.length + work.merge.length };
}
