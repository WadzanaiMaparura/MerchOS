import { describe, it, expect } from 'vitest';
import {
  listTakealotSchemas,
  getRawSchema,
  getSchema,
  getCategoryRule,
  findTemplateForCategoryNode,
} from '../registry.js';

describe('Takealot (ZA) schema registry', () => {
  it('lists all 34 generated loadsheet schemas', () => {
    const list = listTakealotSchemas();
    expect(list.length).toBe(34);
    for (const e of list) {
      expect(e.templateId).toBeTruthy();
      expect(e.fieldCount).toBeGreaterThan(0);
    }
  });

  it('loads a raw schema by template id with resolved enums and categories', () => {
    const raw = getRawSchema('99');
    expect(raw).not.toBeNull();
    expect(raw!.templateId).toBe('99');
    expect(raw!.fields.length).toBe(raw!.fieldCount);

    // color.main is a static enum resolved from a named range.
    const colorMain = raw!.fields.find((f) => f.fieldId === 'color.main');
    expect(colorMain?.dataType).toBe('enum');
    expect(colorMain?.allowedValues).toContain('Black');

    // Category tree is embedded in the loadsheet.
    expect(raw!.categoryTree.length).toBeGreaterThan(0);
    expect(raw!.categoryTree[0]!.leafNodeId).toBeTruthy();
  });

  it('never leaks INDIRECT/VLOOKUP formulas into enum values', () => {
    for (const e of listTakealotSchemas()) {
      const raw = getRawSchema(String(e.templateId))!;
      for (const f of raw.fields) {
        if (Array.isArray(f.allowedValues)) {
          for (const v of f.allowedValues) {
            expect(v).not.toMatch(/INDIRECT|VLOOKUP/);
          }
        }
      }
    }
  });

  it('marks the Category field as a dynamic (category-dependent) list', () => {
    const raw = getRawSchema('99')!;
    const category = raw.fields.find((f) => f.fieldId === 'Category');
    expect(category?.allowedValues).toBeNull();
    expect(category?.allowedValuesSource?.kind).toBe('dynamic');
  });

  it('maps to a canonical MarketplaceSchema with correct requirement levels', () => {
    const schema = getSchema('99');
    expect(schema).not.toBeNull();
    expect(schema!.platform).toBe('takealot');
    expect(schema!.marketplace).toBe('za');
    expect(schema!.verificationStatus).toBe('VERIFIED_FROM_TEMPLATE');
    expect(schema!.exportFormat).toBe('XLSX');
    expect(schema!.columnOrder.length).toBe(schema!.fields.length);

    const title = schema!.fields.find((f) => f.fieldId === 'title');
    expect(title?.required).toBe('required');
    expect(title?.maxLength).toBe(75);
    expect(title?.canonicalMapping).toBe('content.title');

    const colorMain = schema!.fields.find((f) => f.fieldId === 'color.main');
    expect(colorMain?.required).toBe('conditional');
    expect(colorMain?.conditionExpression).toBeTruthy();

    const sku = schema!.fields.find((f) => f.fieldId === 'SKU');
    expect(sku?.required).toBe('optional');
  });

  it('exposes per-category required/recommended rules', () => {
    const raw = getRawSchema('99')!;
    const node = Object.keys(raw.categoryRules)[0]!;
    const rule = getCategoryRule('99', node);
    expect(rule).not.toBeNull();
    expect(Array.isArray(rule!.required)).toBe(true);
    expect(Array.isArray(rule!.recommended)).toBe(true);
  });

  it('finds the owning template for a leaf category node', () => {
    const raw = getRawSchema('99')!;
    const node = raw.categoryTree.find((c) => c.leafNodeId)!.leafNodeId!;
    const templateId = findTemplateForCategoryNode(node);
    expect(templateId).toBeTruthy();
  });
});
