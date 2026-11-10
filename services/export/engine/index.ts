/**
 * @merch-os/export — Export Engine.
 *
 * Deterministic generation of platform-specific export files from validated
 * canonical products. The export is gated on validation upstream (the service
 * layer refuses to export products that have not passed).
 */

export {
  generateExport,
  generateExportXlsx,
  columnsForMode,
  type GenerateExportInput,
  type ExportItem,
  type ExportOutput,
  type XlsxExportOutput,
} from './export-engine.js';
export { serializeCsv, serializeRow, type CsvOptions } from './csv.js';
export { serializeXlsx, type XlsxOptions } from './xlsx.js';
