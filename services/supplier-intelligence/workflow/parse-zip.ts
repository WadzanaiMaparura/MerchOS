/**
 * Step Functions task: HandleZip, parses every CSV / Excel / PDF inside a ZIP.
 * Images inside the archive are not OCR'd (use an image import for those).
 */
import { processZipArchive } from '../processors/zip-handler';
import { finishParse, ImportInputError, markParsing } from './parse-common';
import { readObjectBytes, type StepOutput, type WorkflowInput } from './shared';

export async function handler(input: WorkflowInput): Promise<StepOutput> {
  await markParsing(input);
  const bytes = await readObjectBytes(input.sourceReference);

  let result;
  try {
    result = await processZipArchive(bytes);
  } catch (error) {
    throw new ImportInputError('UNREADABLE_FILE', `The ZIP archive could not be opened: ${(error as Error).message}`);
  }
  return finishParse(input, { records: result.records });
}
