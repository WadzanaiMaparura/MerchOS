/**
 * Image enhancement model adapter.
 *
 * A single, pluggable abstraction over the Bedrock image model used to clean up
 * weak product photos (default: Stability AI **Stable Image Inpaint**). Because
 * Nova Canvas was deprecated, the design deliberately keeps the model behind an
 * adapter so swapping models is a config + IAM change, not a rewrite
 * (blueprint §14 multi-model pattern).
 *
 * The model id comes from configuration (`IMAGE_ENHANCEMENT_MODEL_ID`), and the
 * whole step is feature-flag/region gated (`IMAGE_ENHANCEMENT_ENABLED`). When
 * disabled or unavailable, the pipeline falls back to the deterministic hero.
 *
 * Requirements: 5.2, 5.3, 5.4, 9
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

/** Default Stable Image Inpaint model id on Amazon Bedrock. */
export const DEFAULT_ENHANCEMENT_MODEL_ID = 'stability.stable-image-inpaint-v1:0';

/** Resolve the configured enhancement model id (adapter is model-agnostic). */
export function getEnhancementModelId(): string {
  return process.env['IMAGE_ENHANCEMENT_MODEL_ID'] ?? DEFAULT_ENHANCEMENT_MODEL_ID;
}

/** Whether the enhancement step is enabled in this environment/region. */
export function isEnhancementEnabled(): boolean {
  return (process.env['IMAGE_ENHANCEMENT_ENABLED'] ?? 'false').toLowerCase() === 'true';
}

let bedrockClient: BedrockRuntimeClient | null = null;
function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region });
  }
  return bedrockClient;
}

/** Allow test code to inject a mock Bedrock client. */
export function setBedrockClient(client: BedrockRuntimeClient): void {
  bedrockClient = client;
}

export interface EnhanceImageInput {
  /** Base64-encoded source image the enhancement is conditioned on (required). */
  sourceImageBase64: string;
  /** Text prompt guiding background cleanup/replacement. */
  prompt: string;
}

export interface EnhanceImageOutput {
  /** Base64-encoded enhanced image bytes. */
  imageBase64: string;
}

/**
 * Invoke the configured Bedrock image model to enhance a supplied image.
 *
 * This is **image-to-image only** — `sourceImageBase64` is always provided and
 * conditions the output. The model never fabricates a product from text alone.
 *
 * The request/response body shape is specific to Stable Image Inpaint; a
 * different model would supply its own adapter mapping here.
 */
export async function invokeEnhancementModel(
  input: EnhanceImageInput,
): Promise<EnhanceImageOutput> {
  const modelId = getEnhancementModelId();

  // Stable Image Inpaint request body: condition on the source image + prompt.
  const body = JSON.stringify({
    image: input.sourceImageBase64,
    prompt: input.prompt,
    mode: 'search-and-replace',
    output_format: 'jpeg',
  });

  const response = await getBedrockClient().send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    }),
  );

  const decoded = JSON.parse(new TextDecoder().decode(response.body)) as {
    images?: string[];
    image?: string;
  };

  const imageBase64 = decoded.images?.[0] ?? decoded.image;
  if (!imageBase64) {
    throw new Error('Enhancement model returned no image');
  }

  return { imageBase64 };
}
