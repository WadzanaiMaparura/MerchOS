/** Step Functions task: ParsePdf, extracts product rows from a PDF catalogue in S3. */
import { parsePdf } from '../processors/pdf-parser';
import { finishParse, ImportInputError, markParsing } from './parse-common';
import { readObjectBytes, type StepOutput, type WorkflowInput } from './shared';

export async function handler(input: WorkflowInput): Promise<StepOutput> {
  await markParsing(input);
  const bytes = await readObjectBytes(input.sourceReference);

  let result;
  try {
    result = await parsePdf(bytes);
  } catch (error) {
    throw new ImportInputError('UNREADABLE_FILE', `The PDF could not be read: ${(error as Error).message}`);
  }
  return finishParse(input, { records: result.records });
}
