/**
 * Mapping & Transformation stage (architecture §5).
 *
 * Projects a platform-independent `CanonicalProduct` onto the flat Takealot
 * field-map (fieldId → string cell value) that the deterministic validator and
 * export generator consume.
 *
 * The projection is driven by each schema field's `canonicalMapping` path
 * (e.g. "content.title" → the "title" column). Category-specific attributes
 * (fieldId "Attribute.*") have no fixed canonical path; they are resolved from
 * the canonical `content.attributes` bag by their attribute key.
 *
 * This stage NEVER invents or truncates data (design principle 4). It only
 * reads canonical values and formats them as loadsheet cell strings.
 */

import type { CanonicalProduct } from '@merch-os/types';
import type { RawTakealotSchema } from '@merch-os/marketplace-schemas';

/** A flat Takealot field-map: fieldId → cell value (string) or null. */
export type TakealotFieldMap = Record<string, string | null>;

/** Format a canonical scalar as a loadsheet cell string. */
function formatCell(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    const parts = value.map((v) => (v == null ? '' : String(v))).filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Candidate canonical attribute-bag keys for a Takealot attribute fieldId, in
 * priority order. The canonical `content.attributes` bag may key an attribute
 * by its full dotted path or by its leading segment, and indexed array fields
 * ("...[0]") map to the base name.
 *
 *  "Attribute.whats_in_the_box"                    → ["whats_in_the_box"]
 *  "Attribute.merchant_packaged_dimensions.width"  → ["merchant_packaged_dimensions.width", "merchant_packaged_dimensions"]
 *  "Attribute.materials.[0]"                        → ["materials.[0]", "materials"]
 *  "Attribute.eyewear_type.[0]"                     → ["eyewear_type.[0]", "eyewear_type"]
 */
function attributeKeyCandidates(fieldId: string): string[] {
  const m = /^Attribute\.(.+)$/.exec(fieldId);
  if (!m) return [];
  const suffix = m[1]!;
  const candidates = [suffix];
  // Drop a trailing ".[n]" index.
  const noIndex = suffix.replace(/\.\[\d+\]$/, '');
  if (noIndex !== suffix) candidates.push(noIndex);
  // Fall back to the leading segment.
  const head = noIndex.split('.')[0]!;
  if (!candidates.includes(head)) candidates.push(head);
  return candidates;
}

/** Image column index from "Images.image_url_3" → 3 (1-based), else null. */
function imageColumnIndex(fieldId: string): number | null {
  const m = /^Images\.image_url_(\d+)$/.exec(fieldId);
  return m ? Number(m[1]) : null;
}

export interface MapOptions {
  /**
   * The Takealot leaf category node id + the display values for the two
   * category columns. The canonical model stores a single category mapping
   * string; callers that know the resolved category supply the display forms.
   */
  topCategory?: string;
  category?: string;
  /**
   * Resolves a canonical image s3Key to a public URL (export stage). When
   * omitted, the s3Key itself is used as a presence placeholder — sufficient
   * for validation, which only checks that an image exists at the position.
   */
  imageUrlResolver?: (s3Key: string) => string;
}

/**
 * Build the Takealot field-map for a canonical product against a schema.
 * Only fields the schema defines are populated; unmapped fields are omitted.
 */
export function mapCanonicalToTakealot(
  product: CanonicalProduct,
  schema: RawTakealotSchema,
  options: MapOptions = {}
): TakealotFieldMap {
  const out: TakealotFieldMap = {};
  const content = product.content;

  for (const field of schema.fields) {
    const id = field.fieldId;

    // Category columns come from explicit options (resolved upstream) or the
    // canonical platform category mapping.
    if (id === 'TopCategory') {
      out[id] = options.topCategory ?? null;
      continue;
    }
    if (id === 'Category') {
      out[id] =
        options.category ??
        formatCell(product.platformSpecific?.categoryMappings?.takealot) ??
        null;
      continue;
    }

    // Core fields with a declared canonical mapping path.
    if (field.fieldClass === 'core') {
      switch (id) {
        case 'title':
          out[id] = formatCell(content.title);
          break;
        case 'subtitle':
          out[id] = formatCell(content.shortDescription);
          break;
        case 'description':
          out[id] = formatCell(content.longDescription);
          break;
        case 'Brand':
          out[id] = formatCell(content.brand);
          break;
        case 'SKU':
          out[id] = formatCell(content.sku);
          break;
        case 'ProductID.Value':
          out[id] = formatCell(content.barcode);
          break;
        default:
          out[id] = null;
      }
      continue;
    }

    // Images: a positional image reference resolves (at export time) to a URL.
    // For validation we represent presence with the reference's addressable key.
    const imgIdx = imageColumnIndex(id);
    if (imgIdx != null) {
      const ref = content.imageRefs?.[imgIdx - 1];
      out[id] = ref ? (options.imageUrlResolver?.(ref.s3Key) ?? ref.s3Key) : null;
      continue;
    }

    // Category attributes: resolve from the canonical attribute bag, trying the
    // full dotted path, the de-indexed path, then the leading segment.
    if (id.startsWith('Attribute.')) {
      let resolved: string | null = null;
      for (const cand of attributeKeyCandidates(id)) {
        if (content.attributes && cand in content.attributes) {
          resolved = formatCell(content.attributes[cand]);
          break;
        }
      }
      out[id] = resolved;
      continue;
    }

    // color.* maps from the attribute bag using the dotted suffix as the key.
    if (id.startsWith('color.')) {
      const colorKey = id; // e.g. stored as "color.main" in attributes if present
      const alt = id.slice('color.'.length);
      const v =
        content.attributes?.[colorKey] ?? content.attributes?.[`color_${alt}`] ?? null;
      out[id] = formatCell(v);
      continue;
    }

    out[id] = null;
  }

  return out;
}
