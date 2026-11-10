/**
 * Schema reconciliation against REAL Takealot submission outcomes.
 *
 * Ground truth: `generated/takealot-za/_submission-fixtures.json`, extracted
 * from the committed submission-results workbooks. Each row carries its actual
 * Takealot outcome plus the two reason columns:
 *   - systemValidation — deterministic failures (what our validator checks)
 *   - rejectionReason  — human content-review failures (out of scope)
 *
 * The decisive assertion: our deterministic validator must NOT raise ERRORs on
 * products that Takealot accepted (or that passed system validation). Over-
 * rejection is the dangerous failure mode — it would block legitimate sellers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getRawSchema } from '../registry.js';
import { validateProduct, parseNodeId } from '../validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', '..', 'generated', 'takealot-za', '_submission-fixtures.json');

interface FixtureRow {
  outcome: 'rejected' | 'created' | 'existing';
  systemValidation: string | null;
  rejectionReason: string | null;
  data: Record<string, string>;
}
interface Fixture {
  sourceFile: string;
  templateId: string | null;
  rowCount: number;
  rows: FixtureRow[];
}

const fixtures: Fixture[] = JSON.parse(readFileSync(FIXTURES, 'utf8'));

describe('schema reconciliation vs real Takealot submission outcomes', () => {
  it('has at least one data-bearing submission fixture', () => {
    const withData = fixtures.filter((f) => f.rowCount > 0);
    expect(withData.length).toBeGreaterThan(0);
  });

  // Products Takealot ACCEPTED, or that passed system validation, must not
  // produce deterministic ERRORs in our validator.
  const acceptedRows = fixtures.flatMap((f) =>
    f.rows
      .filter((r) => r.outcome !== 'rejected' || !r.systemValidation)
      .map((r) => ({ templateId: f.templateId!, row: r }))
  );

  it('found accepted / system-passed products to reconcile', () => {
    expect(acceptedRows.length).toBeGreaterThan(0);
  });

  for (const [i, { templateId, row }] of acceptedRows.entries()) {
    it(`accepted product #${i + 1} (template ${templateId}) raises no false ERRORs`, () => {
      const schema = getRawSchema(templateId);
      expect(schema, `schema for template ${templateId} should exist`).not.toBeNull();

      const categoryNodeId = parseNodeId(row.data['Category']);
      const result = validateProduct(
        schema!,
        row.data,
        categoryNodeId ? { categoryNodeId } : {}
      );

      if (!result.ok) {
        // Surface exactly what over-rejected, to make failures actionable.
        const errs = result.findings.filter((f) => f.severity === 'ERROR');
        throw new Error(
          `Expected 0 ERRORs for an accepted product but got ${errs.length}:\n` +
            errs.map((e) => `  [${e.code}] ${e.message}`).join('\n')
        );
      }
      expect(result.errorCount).toBe(0);
    });
  }

  // Sanity: a product that passed system validation but failed REVIEW is still
  // structurally valid to us (we don't judge content), so it must also pass.
  it('a review-rejected (but system-valid) product still passes deterministic validation', () => {
    const reviewRejected = fixtures
      .flatMap((f) => f.rows.map((r) => ({ templateId: f.templateId!, row: r })))
      .find((x) => x.row.outcome === 'rejected' && !x.row.systemValidation && x.row.rejectionReason);

    // If the dataset contains such a row, it must validate clean.
    if (reviewRejected) {
      const schema = getRawSchema(reviewRejected.templateId)!;
      const categoryNodeId = parseNodeId(reviewRejected.row.data['Category']);
      const result = validateProduct(
        schema,
        reviewRejected.row.data,
        categoryNodeId ? { categoryNodeId } : {}
      );
      expect(result.errorCount).toBe(0);
    }
  });
});
