/**
 * Prompt Manager service for the Product Intelligence Engine.
 *
 * Manages versioned prompt templates stored in DynamoDB with support for
 * A/B testing traffic distribution, monotonically increasing version numbers,
 * and double-brace variable interpolation.
 *
 * @module prompt-manager
 */

import { randomUUID } from 'crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { GenerationType } from '../types/generation.types';
import type {
  ABTestConfig,
  CreatePromptTemplateInput,
  PromptTemplate,
} from '../types/prompt.types';
import type { PromptTemplateItem } from '../types/dynamo.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** DynamoDB table name from environment */
const TABLE_NAME = process.env['PRODUCT_INTELLIGENCE_TABLE'] ?? 'product-intelligence';

// ---------------------------------------------------------------------------
// DynamoDB Client Setup
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}

/**
 * Override the DynamoDB Document Client (used for testing).
 *
 * @param client - The mock or test DynamoDB document client
 */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// Prompt Manager Class
// ---------------------------------------------------------------------------

/**
 * Prompt Manager service that stores, versions, and selects prompt templates
 * with A/B testing support.
 *
 * Implements:
 * - Versioned template storage in DynamoDB
 * - Monotonically increasing version numbers per generation type
 * - A/B testing with traffic-percentage-based variant selection
 * - Double-brace variable interpolation
 */
export class PromptManager {
  /**
   * Retrieves the active prompt template for a given generation type.
   *
   * When A/B testing is enabled (via abConfig), selects a variant based on
   * configured traffic percentages using cumulative distribution. Otherwise,
   * returns the most recent active template.
   *
   * Property 19: A/B testing distributes traffic based on configured percentages.
   *
   * @param generationType - The generation type to retrieve a template for
   * @param abConfig - Optional A/B test configuration with variant traffic percentages
   * @returns The selected active PromptTemplate
   * @throws Error if no active template exists for the generation type
   */
  async getActiveTemplate(
    generationType: GenerationType,
    abConfig?: ABTestConfig,
  ): Promise<PromptTemplate> {
    const client = getDynamoDocClient();

    // If A/B testing is enabled and has variants, select based on traffic percentages
    if (abConfig?.enabled && abConfig.variants.length > 0) {
      return this.selectABVariant(generationType, abConfig);
    }

    // Query for active templates for this generation type
    const response = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'active = :active',
        ExpressionAttributeValues: {
          ':pk': `PROMPT#${generationType}`,
          ':skPrefix': 'VERSION#',
          ':active': true,
        },
        ScanIndexForward: false, // Descending order to get the most recent first
      }),
    );

    const items = (response.Items ?? []) as PromptTemplateItem[];

    if (items.length === 0) {
      throw new Error(`No active prompt template found for generation type: ${generationType}`);
    }

    // Return the template with the highest version number
    const sorted = items.sort((a, b) => b.version - a.version);
    return this.itemToTemplate(sorted[0]!);
  }

  /**
   * Creates a new prompt template version with a monotonically increasing version number.
   *
   * Queries existing versions for the generation type to find the maximum version,
   * then assigns the next version number (max + 1).
   *
   * Property 17: Each new version number is strictly greater than all previous versions
   * for the same generation type.
   *
   * @param template - The template creation input
   * @returns The created PromptTemplate with assigned version number and ID
   */
  async createVersion(template: CreatePromptTemplateInput): Promise<PromptTemplate> {
    const client = getDynamoDocClient();

    // Query all existing versions to find the maximum version number
    const response = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `PROMPT#${template.generationType}`,
          ':skPrefix': 'VERSION#',
        },
        ScanIndexForward: false, // Descending to get highest version first
        Limit: 1,
      }),
    );

    const existingItems = (response.Items ?? []) as PromptTemplateItem[];
    const maxVersion = existingItems.length > 0 ? existingItems[0]!.version : 0;
    const newVersion = maxVersion + 1;

    const templateId = randomUUID();
    const now = new Date().toISOString();

    // Pad version number to ensure correct lexicographic ordering in DynamoDB SK
    const paddedVersion = String(newVersion).padStart(10, '0');

    const item: PromptTemplateItem = {
      PK: `PROMPT#${template.generationType}`,
      SK: `VERSION#${paddedVersion}`,
      templateId,
      generationType: template.generationType,
      version: newVersion,
      content: template.content,
      variables: template.variables,
      active: template.active,
      ...(template.trafficPercentage !== undefined
        ? { trafficPercentage: template.trafficPercentage }
        : {}),
      createdAt: now,
      createdBy: template.createdBy,
    };

    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }),
    );

    return this.itemToTemplate(item);
  }

  /**
   * Deactivates a specific prompt template version by setting its active field to false.
   *
   * After deactivation, the Prompt Manager will fall back to the most recent active version
   * for that generation type.
   *
   * @param templateId - The unique identifier of the template to deactivate
   * @param version - The version number of the template to deactivate
   * @throws Error if the template is not found
   */
  async deactivateVersion(templateId: string, version: number): Promise<void> {
    const client = getDynamoDocClient();

    // We need to find the item by templateId and version to get the PK/SK
    // Since we know the SK format, we need to find which generationType this belongs to
    // Query using a scan with filter on templateId (in production a GSI would be more efficient)
    // However, since we have the version, we can construct the SK
    const paddedVersion = String(version).padStart(10, '0');

    // We need to find the generation type for this template to construct the PK.
    // Use a scan with filter on templateId to locate the item.
    // In a production system, a GSI on templateId would be more efficient.
    // For now, query all PROMPT# prefixed items with this version.
    // A simpler approach: the caller provides enough info to locate it,
    // or we scan. Let's find by templateId.

    // Alternative approach: Query all generation types' version to find the one matching
    // For efficiency, we'll do a targeted update if we can locate the PK.
    // Since the design uses PK=PROMPT#{generationType} and SK=VERSION#{version},
    // and we receive templateId + version, we need to find the generation type.
    // The most robust approach queries all PROMPT# items for the version.

    // Query to find the item by scanning for the templateId
    const generationTypes: GenerationType[] = [
      'title',
      'description',
      'bullets',
      'seo',
      'category',
      'brand',
      'attributes',
      'keywords',
      'compliance',
    ];

    for (const genType of generationTypes) {
      const sk = `VERSION#${paddedVersion}`;
      const queryResponse = await client.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND SK = :sk',
          FilterExpression: 'templateId = :templateId',
          ExpressionAttributeValues: {
            ':pk': `PROMPT#${genType}`,
            ':sk': sk,
            ':templateId': templateId,
          },
        }),
      );

      if (queryResponse.Items && queryResponse.Items.length > 0) {
        // Found it — update active to false
        await client.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
              PK: `PROMPT#${genType}`,
              SK: sk,
            },
            UpdateExpression: 'SET active = :inactive',
            ExpressionAttributeValues: {
              ':inactive': false,
            },
          }),
        );
        return;
      }
    }

    throw new Error(
      `Prompt template not found: templateId=${templateId}, version=${version}`,
    );
  }

  /**
   * Interpolates a prompt template string by replacing all {{variable_name}} placeholders
   * with corresponding values from the variables map.
   *
   * Property 5: Interpolation replaces ALL {{variable}} placeholders with values
   * and no double-brace placeholders remain.
   *
   * @param template - The template string containing {{variable}} placeholders
   * @param variables - A map of variable names to their replacement values
   * @returns The interpolated string with all placeholders replaced
   */
  interpolate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, variableName: string) => {
      return variables[variableName] ?? '';
    });
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Selects an A/B test variant based on configured traffic percentages.
   *
   * Uses Math.random() against cumulative traffic percentages to determine
   * which variant to select. If the selected variant cannot be found in DynamoDB,
   * falls back to the first available variant.
   *
   * @param generationType - The generation type
   * @param abConfig - The A/B test configuration
   * @returns The selected PromptTemplate variant
   */
  private async selectABVariant(
    generationType: GenerationType,
    abConfig: ABTestConfig,
  ): Promise<PromptTemplate> {
    const client = getDynamoDocClient();
    const random = Math.random() * 100;

    // Select variant based on cumulative traffic percentages
    let cumulative = 0;
    let selectedVariant = abConfig.variants[0]!;

    for (const variant of abConfig.variants) {
      cumulative += variant.trafficPercentage;
      if (random < cumulative) {
        selectedVariant = variant;
        break;
      }
    }

    // Fetch the selected template from DynamoDB
    const paddedVersion = String(selectedVariant.version).padStart(10, '0');
    const response = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': `PROMPT#${generationType}`,
          ':sk': `VERSION#${paddedVersion}`,
        },
      }),
    );

    const items = (response.Items ?? []) as PromptTemplateItem[];

    if (items.length === 0) {
      // Fallback: get the most recent active template
      return this.getActiveTemplate(generationType);
    }

    return this.itemToTemplate(items[0]!);
  }

  /**
   * Converts a DynamoDB PromptTemplateItem to a PromptTemplate domain object.
   *
   * @param item - The DynamoDB item
   * @returns The PromptTemplate domain object
   */
  private itemToTemplate(item: PromptTemplateItem): PromptTemplate {
    return {
      templateId: item.templateId,
      generationType: item.generationType,
      version: item.version,
      content: item.content,
      variables: item.variables,
      active: item.active,
      createdAt: item.createdAt,
      ...(item.trafficPercentage !== undefined
        ? { trafficPercentage: item.trafficPercentage }
        : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared PromptManager instance */
export const promptManager = new PromptManager();
