/**
 * Bedrock Client service for the Product Intelligence Engine.
 *
 * Encapsulates all Amazon Bedrock API interactions with exponential backoff
 * retry logic (full jitter), input/output token tracking, and EventBridge
 * failure event emission when all retries are exhausted.
 *
 * @see Requirements 14.1, 14.2, 14.3, 14.4, 14.5
 */

import {
  BedrockRuntimeClient,
  BedrockRuntimeClientConfig,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  EventBridgeClient,
  EventBridgeClientConfig,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Parameters for invoking a Bedrock model.
 */
export interface BedrockInvocationParams {
  /** The Bedrock model ID to invoke (e.g., 'anthropic.claude-3-haiku-20240307-v1:0') */
  modelId: string;
  /** The prompt text to send to the model */
  prompt: string;
  /** Maximum number of output tokens to generate */
  maxTokens: number;
  /** Sampling temperature (0-1). Higher values = more randomness */
  temperature?: number;
  /** Top-p nucleus sampling parameter */
  topP?: number;
  /** Sequences that signal the model to stop generating */
  stopSequences?: string[];
}

/**
 * Result from a successful Bedrock model invocation.
 */
export interface BedrockInvocationResult {
  /** The generated text content */
  content: string;
  /** Number of input tokens consumed */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** The model ID that was invoked */
  modelId: string;
  /** End-to-end latency in milliseconds */
  latencyMs: number;
}

/**
 * Error thrown when Bedrock is unavailable after all retry attempts.
 */
export interface BedrockUnavailableError {
  code: 'BEDROCK_UNAVAILABLE';
  message: string;
  modelId: string;
  attempts: number;
  lastError: string;
}

/**
 * Retry configuration for the Bedrock Client.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial backoff interval in milliseconds (default: 1000) */
  initialBackoffMs: number;
  /** Backoff multiplier (default: 2) */
  multiplier: number;
  /** Maximum backoff interval in milliseconds (default: 10000) */
  maxBackoffMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REGION = 'af-south-1';

const PRODUCT_INTELLIGENCE_EVENT_SOURCE = 'merch-os.product-intelligence';
const BEDROCK_FAILURE_DETAIL_TYPE = 'product-intelligence.bedrock-failure';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  multiplier: 2,
  maxBackoffMs: 10000,
};

/**
 * Error names that are retryable.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  'ThrottlingException',
  'ServiceUnavailableException',
  'InternalServerError',
]);

// ---------------------------------------------------------------------------
// Client Singletons
// ---------------------------------------------------------------------------

let bedrockClientInstance: BedrockRuntimeClient | null = null;
let eventBridgeClientInstance: EventBridgeClient | null = null;

/**
 * Returns a singleton BedrockRuntimeClient.
 */
export function getBedrockClient(
  config?: BedrockRuntimeClientConfig,
): BedrockRuntimeClient {
  if (!bedrockClientInstance) {
    bedrockClientInstance = new BedrockRuntimeClient({
      region: process.env['AWS_REGION'] ?? DEFAULT_REGION,
      ...config,
    });
  }
  return bedrockClientInstance;
}

/**
 * Returns a singleton EventBridgeClient for failure events.
 */
export function getEventBridgeClient(
  config?: EventBridgeClientConfig,
): EventBridgeClient {
  if (!eventBridgeClientInstance) {
    eventBridgeClientInstance = new EventBridgeClient({
      region: process.env['AWS_REGION'] ?? DEFAULT_REGION,
      ...config,
    });
  }
  return eventBridgeClientInstance;
}

/**
 * Resets singleton clients. Useful for testing.
 */
export function resetClientsForTesting(): void {
  bedrockClientInstance = null;
  eventBridgeClientInstance = null;
}

// ---------------------------------------------------------------------------
// Retry Utilities
// ---------------------------------------------------------------------------

/**
 * Calculates the backoff interval for a given retry attempt (before jitter).
 *
 * Formula: min(initialBackoff * multiplier^attempt, maxBackoff)
 *
 * @param attempt - The retry attempt number (1-based: 1, 2, 3)
 * @param config - Retry configuration
 * @returns The calculated backoff in milliseconds
 */
export function calculateBackoff(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const backoff = config.initialBackoffMs * Math.pow(config.multiplier, attempt);
  return Math.min(backoff, config.maxBackoffMs);
}

/**
 * Applies full jitter to a calculated backoff value.
 * Full jitter returns a random value in [0, calculatedBackoff].
 *
 * @param calculatedBackoff - The backoff value before jitter
 * @param randomFn - Optional random function for testing (default: Math.random)
 * @returns The jittered delay in milliseconds
 */
export function applyFullJitter(
  calculatedBackoff: number,
  randomFn: () => number = Math.random,
): number {
  return randomFn() * calculatedBackoff;
}

/**
 * Determines if an error is retryable.
 */
export function isRetryableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const name = (error as { name?: string }).name;
    if (name && RETRYABLE_ERROR_NAMES.has(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Sleep helper that returns a promise resolved after the specified delay.
 *
 * @param ms - Duration to sleep in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// EventBridge Failure Emission
// ---------------------------------------------------------------------------

/**
 * Emits a `product-intelligence.bedrock-failure` event to EventBridge.
 *
 * Called after all retry attempts are exhausted to notify downstream
 * systems of Bedrock unavailability.
 *
 * @param params - Details about the failed invocation
 * @see Requirement 14.5
 */
export async function emitBedrockFailureEvent(params: {
  modelId: string;
  attempts: number;
  lastError: string;
  prompt?: string;
}): Promise<void> {
  const eventBusName = process.env['EVENT_BUS_NAME'];
  if (!eventBusName) {
    // Silently skip if no bus is configured (e.g., in unit tests)
    return;
  }

  const client = getEventBridgeClient();
  const command = new PutEventsCommand({
    Entries: [
      {
        Source: PRODUCT_INTELLIGENCE_EVENT_SOURCE,
        DetailType: BEDROCK_FAILURE_DETAIL_TYPE,
        Detail: JSON.stringify({
          modelId: params.modelId,
          attempts: params.attempts,
          lastError: params.lastError,
          timestamp: new Date().toISOString(),
        }),
        EventBusName: eventBusName,
        Time: new Date(),
      },
    ],
  });

  await client.send(command);
}

// ---------------------------------------------------------------------------
// Bedrock Client
// ---------------------------------------------------------------------------

/**
 * Options for the BedrockClient class.
 */
export interface BedrockClientOptions {
  /** Custom retry configuration */
  retryConfig?: Partial<RetryConfig>;
  /** Custom Bedrock client configuration */
  bedrockClientConfig?: BedrockRuntimeClientConfig;
  /** Custom EventBridge client configuration */
  eventBridgeClientConfig?: EventBridgeClientConfig;
  /** Custom sleep function for testing */
  sleepFn?: (ms: number) => Promise<void>;
  /** Custom random function for testing jitter */
  randomFn?: () => number;
}

/**
 * Bedrock Client service with retry logic, token tracking, and failure events.
 *
 * Implements exponential backoff with full jitter as per the design:
 * - Max retries: 3
 * - Initial backoff: 1s
 * - Multiplier: 2
 * - Max backoff: 10s
 * - Full jitter: random(0, calculated_backoff)
 *
 * Retries on: ThrottlingException, ServiceUnavailableException, InternalServerError
 *
 * After all retries exhausted:
 * - Returns error with code "BEDROCK_UNAVAILABLE"
 * - Emits product-intelligence.bedrock-failure EventBridge event
 *
 * @see Requirements 14.1, 14.2, 14.3, 14.4, 14.5
 */
export class BedrockClient {
  private readonly retryConfig: RetryConfig;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly randomFn: () => number;

  constructor(options: BedrockClientOptions = {}) {
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...options.retryConfig,
    };
    this.sleepFn = options.sleepFn ?? sleep;
    this.randomFn = options.randomFn ?? Math.random;

    if (options.bedrockClientConfig) {
      getBedrockClient(options.bedrockClientConfig);
    }
    if (options.eventBridgeClientConfig) {
      getEventBridgeClient(options.eventBridgeClientConfig);
    }
  }

  /**
   * Invokes a Bedrock model with the given parameters.
   *
   * Implements retry logic with exponential backoff and full jitter.
   * Tracks input/output tokens and latency in the response.
   *
   * @param params - The invocation parameters
   * @returns The invocation result with content, tokens, and latency
   * @throws BedrockUnavailableError if all retries are exhausted
   *
   * @see Requirements 14.1, 14.2, 14.3, 14.4, 14.5
   */
  async invoke(params: BedrockInvocationParams): Promise<BedrockInvocationResult> {
    const { modelId, prompt, maxTokens, temperature, topP, stopSequences } = params;
    const maxAttempts = 1 + this.retryConfig.maxRetries; // 1 initial + retries
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Wait before retrying (skip for the initial attempt)
      if (attempt > 0) {
        const backoff = calculateBackoff(attempt, this.retryConfig);
        const jitteredDelay = applyFullJitter(backoff, this.randomFn);
        await this.sleepFn(jitteredDelay);
      }

      const startTime = Date.now();

      try {
        const body = JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
          ...(temperature !== undefined && { temperature }),
          ...(topP !== undefined && { top_p: topP }),
          ...(stopSequences?.length && { stop_sequences: stopSequences }),
        });

        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: new TextEncoder().encode(body),
        });

        const client = getBedrockClient();
        const response = await client.send(command);

        const latencyMs = Date.now() - startTime;

        // Parse the response body
        const responseBody = JSON.parse(
          new TextDecoder().decode(response.body),
        );

        const content = responseBody.content?.[0]?.text ?? '';
        const inputTokens = responseBody.usage?.input_tokens ?? 0;
        const outputTokens = responseBody.usage?.output_tokens ?? 0;

        return {
          content,
          inputTokens,
          outputTokens,
          modelId,
          latencyMs,
        };
      } catch (error: unknown) {
        lastError = error;

        // Only retry on retryable errors
        if (!isRetryableError(error)) {
          break;
        }

        // If this was the last attempt, break to emit failure
        if (attempt === maxAttempts - 1) {
          break;
        }
      }
    }

    // All retries exhausted — emit failure event and throw
    const errorMessage = lastError instanceof Error
      ? lastError.message
      : String(lastError);

    await emitBedrockFailureEvent({
      modelId,
      attempts: maxAttempts,
      lastError: errorMessage,
    });

    const unavailableError: BedrockUnavailableError = {
      code: 'BEDROCK_UNAVAILABLE',
      message: `Bedrock invocation failed after ${maxAttempts} attempts: ${errorMessage}`,
      modelId,
      attempts: maxAttempts,
      lastError: errorMessage,
    };

    throw unavailableError;
  }
}
