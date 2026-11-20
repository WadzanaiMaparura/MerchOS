/** Step Functions task: ParseFile (CSV / Excel), reads the seller's upload from S3. */
import { parseCsv, parseExcel } from '../processors/file-parser';
import { finishParse, ImportInputError, markParsing } from './parse-common';
import { readObjectBytes, type StepOutput, type WorkflowInput } from './shared';

export async function handler(input: WorkflowInput): Promise<StepOutput> {
  await markParsing(input);
  const bytes = await readObjectBytes(input.sourceReference);

  let result;
  try {
    result = input.sourceType === 'FILE_EXCEL' ? await parseExcel(bytes) : parseCsv(bytes);
  } catch (error) {
    throw new ImportInputError(
      'UNREADABLE_FILE',
      `The file could not be read as ${input.sourceType === 'FILE_EXCEL' ? 'an Excel workbook' : 'CSV'}: ${(error as Error).message}`,
    );
  }
  return finishParse(input, { records: result.records });
}
