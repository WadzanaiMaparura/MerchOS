/**
 * Export Engine (architecture §6).
 *
 * Generates a platform-specific export document from one or more canonical
 * products that have passed validation. For Takealot this is a loadsheet-shaped
 * CSV whose columns follow the schema's exact `columnOrder`.
 *
 * Invariants (mirroring the validation engine):
 *   - Never invent or truncate data — cells reflect the mapped values exactly.
 *   - Deterministic — same products + schema + mode ⇒ byte-identical output.
 *   - Validation is a hard gate — export generation refuses to run for products
 *     that have not passed validation (exportAllowed === false), unless the
 *     caller explicitly excludes them (partial batch).
 */

import type { CanonicalProduct, ExportMode } from '@merch-os/types';
import type { RawTakealotSchema } from '@merch-os/marketplace-schemas';
import { mapCanonicalToTakealot, type MapOptions, type TakealotFieldMap } from '@merch-os/validation';
import { serializeCsv, type CsvOptions } from './csv.js';

/** Column subsets per export mode (architecture §6.2, §5.5 Takealot notes). */
const OFFER_FIELDS = [
  'ProductID.Value', // barcode — primary linking identifier
  'SKU',
  'StockOnHand',
  'SellingPrice',
  'RRP',
  'Leadtime',
];
const INVENTORY_FIELDS = ['ProductID.Value', 'SKU', 'StockOnHand'];
const PRICE_FIELDS = ['ProductID.Value', 'SKU', 'SellingPrice', 'RRP'];

/**
 * Resolve the ordered column list for a mode.
 * - full-create: the schema's full columnOrder (product creation).
 * - offer/inventory/price: the fixed offer-style subset, intersected with
 *   columns the schema actually defines (so we never emit unknown columns).
 */
export function columnsForMode(schema: RawTakealotSchema, mode: ExportMode): string[] {
  if (mode === 'full-create') return [...schema.columnOrder];
  const defined = new Set(schema.columnOrder);
  const subset =
    mode === 'inventory-sync'
      ? INVENTORY_FIELDS
      : mode === 'price-update'
        ? PRICE_FIELDS
        : OFFER_FIELDS; // offer-update
  // Keep subset fields that the schema defines; offer/price/stock columns that
  // are not in a product-creation loadsheet are still valid Takealot offer
  // columns, so retain them even if absent from columnOrder.
  return subset.filter((f) => defined.has(f) || !isCreationColumn(f));
}

/** Offer/stock/price columns that exist on the offers template, not creation. */
function isCreationColumn(fieldId: string): boolean {
  return !['StockOnHand', 'SellingPrice', 'RRP', 'Leadtime'].includes(fieldId);
}

export interface ExportItem {
  product: CanonicalProduct;
  /** Per-product mapping options (resolved category display values, image URLs). */
  mapOptions?: MapOptions;
  /** Commercial overrides for offer/price/inventory columns (not in the schema map). */
  offer?: {
    stockOnHand?: number;
    sellingPrice?: number;
    rrp?: number;
    leadtimeDays?: number;
  };
}

export interface GenerateExportInput {
  schema: RawTakealotSchema;
  mode: ExportMode;
  items: ReadonlyArray<ExportItem>;
  csv?: CsvOptions;
}

export interface ExportOutput {
  format: 'CSV';
  filename: string;
  content: string;
  rowCount: number;
  columns: string[];
}

/** Build the cell value for a column, pulling from the field-map or offer data. */
function cellFor(
  fieldId: string,
  fieldMap: TakealotFieldMap,
  offer: ExportItem['offer']
): string {
  switch (fieldId) {
    case 'StockOnHand':
      return offer?.stockOnHand != null ? String(offer.stockOnHand) : '';
    case 'SellingPrice':
      return offer?.sellingPrice != null ? String(offer.sellingPrice) : '';
    case 'RRP':
      return offer?.rrp != null ? String(offer.rrp) : '';
    case 'Leadtime':
      return offer?.leadtimeDays != null ? String(offer.leadtimeDays) : '';
    default:
      return fieldMap[fieldId] ?? '';
  }
}

/**
 * Generate the export document. Pure and deterministic.
 */
export function generateExport(input: GenerateExportInput): ExportOutput {
  const { schema, mode, items } = input;
  const columns = columnsForMode(schema, mode);

  const csvOptions: CsvOptions = {
    delimiter: schema.delimiter || ',',
    ...input.csv,
  };

  const rows: string[][] = items.map((item) => {
    const fieldMap = mapCanonicalToTakealot(item.product, schema, item.mapOptions ?? {});
    // Default offer values from the canonical commercial domain when not given.
    const commercial = item.product.commercial;
    const offer: NonNullable<ExportItem['offer']> = {};
    const stock = item.offer?.stockOnHand ?? commercial?.stockQuantity;
    const price = item.offer?.sellingPrice ?? commercial?.sellingPrice;
    const rrp = item.offer?.rrp ?? commercial?.rrp;
    const leadtime = item.offer?.leadtimeDays ?? commercial?.leadtimeDays;
    if (stock != null) offer.stockOnHand = stock;
    if (price != null) offer.sellingPrice = price;
    if (rrp != null) offer.rrp = rrp;
    if (leadtime != null) offer.leadtimeDays = leadtime;
    return columns.map((col) => cellFor(col, fieldMap, offer));
  });

  const content = serializeCsv(columns, rows, csvOptions);
  const filename = `takealot-${mode}-${schema.templateId ?? 'schema'}-${items.length}.csv`;

  return { format: 'CSV', filename, content, rowCount: rows.length, columns };
}
