/**
 * @merch-os/export — Export Engine.
 *
 * Deterministic generation of platform-specific export files from validated
 * canonical products. The export is gated on validation upstream (the service
 * layer refuses to export products that have not passed).
 */

export {
  generateExport,
  columnsForMode,
  type GenerateExportInput,
  type ExportItem,
  type ExportOutput,
} from './export-engine.js';
export { serializeCsv, serializeRow, type CsvOptions } from './csv.js';
