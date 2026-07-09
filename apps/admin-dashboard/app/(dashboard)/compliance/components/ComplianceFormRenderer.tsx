'use client';

import React, { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ComplianceRuleSet } from '@merch-os/types';
import { Input } from '@merch-os/ui';
import { Select } from '@merch-os/ui';

// ─── JSON Schema Field Types ───────────────────────────────────────────────────

interface JsonSchemaProperty {
  type?: 'string' | 'number' | 'boolean' | 'integer';
  title?: string;
  description?: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

interface JsonSchemaObject {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  title?: string;
  description?: string;
}

// ─── Zod Schema Builder ────────────────────────────────────────────────────────

/**
 * Builds a Zod schema from a JSON schema object definition.
 * Supports string, number, integer, boolean, and enum fields.
 */
function buildZodSchema(
  jsonSchema: Record<string, unknown>
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const schema = jsonSchema as unknown as JsonSchemaObject;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    let fieldSchema: z.ZodTypeAny;

    if (prop.enum && prop.enum.length > 0) {
      // Enum: use z.enum or z.union of literals
      const enumValues = prop.enum.map(String);
      fieldSchema = z.enum(enumValues as [string, ...string[]]);
    } else {
      switch (prop.type) {
        case 'number':
        case 'integer': {
          let numSchema = z.coerce.number();
          if (prop.minimum !== undefined) numSchema = numSchema.min(prop.minimum);
          if (prop.maximum !== undefined) numSchema = numSchema.max(prop.maximum);
          fieldSchema = numSchema;
          break;
        }
        case 'boolean':
          fieldSchema = z.boolean();
          break;
        case 'string':
        default: {
          let strSchema = z.string();
          if (prop.minLength !== undefined) strSchema = strSchema.min(prop.minLength);
          if (prop.maxLength !== undefined) strSchema = strSchema.max(prop.maxLength);
          if (prop.pattern !== undefined) strSchema = strSchema.regex(new RegExp(prop.pattern));
          fieldSchema = strSchema;
          break;
        }
      }
    }

    shape[key] = isRequired ? fieldSchema : fieldSchema.optional();
  }

  return z.object(shape);
}

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface ComplianceFormRendererProps {
  /** The full compliance rule set (schema + current values) */
  ruleSet: ComplianceRuleSet;
  /** Called with the validated form values when the form is submitted externally */
  onSubmit: (values: Record<string, unknown>) => void;
  /** Called whenever any field value changes */
  onChange?: (values: Record<string, unknown>) => void;
  /** Whether the form is currently being submitted (disables inputs) */
  isSubmitting?: boolean;
  /**
   * External trigger: when this prop changes to a new non-null symbol/counter,
   * the form will attempt submission. Used by the parent page's Save button.
   */
  submitTrigger?: number;
}

// ─── Individual Field Renderer ─────────────────────────────────────────────────

interface FieldRendererProps {
  fieldKey: string;
  property: JsonSchemaProperty;
  isRequired: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  error?: string;
  isSubmitting: boolean;
}

function FieldRenderer({
  fieldKey,
  property,
  isRequired,
  control,
  error,
  isSubmitting,
}: FieldRendererProps) {
  const label = property.title ?? fieldKey;
  const fieldId = `compliance-field-${fieldKey}`;

  // Enum field → Select
  if (property.enum && property.enum.length > 0) {
    const options = property.enum.map((v) => ({ value: String(v), label: String(v) }));
    return (
      <div key={fieldKey} className="flex flex-col gap-1">
        <Controller
          name={fieldKey}
          control={control}
          render={({ field }) => (
            <Select
              id={fieldId}
              label={`${label}${isRequired ? ' *' : ''}`}
              value={field.value !== undefined ? String(field.value) : ''}
              onValueChange={(val) => field.onChange(val)}
              options={options}
              disabled={isSubmitting}
            />
          )}
        />
        {property.description && (
          <p className="text-xs text-gray-500">{property.description}</p>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert" aria-live="assertive">
            {error}
          </p>
        )}
      </div>
    );
  }

  // Boolean field → checkbox
  if (property.type === 'boolean') {
    return (
      <div key={fieldKey} className="flex flex-col gap-1">
        <Controller
          name={fieldKey}
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <input
                id={fieldId}
                type="checkbox"
                checked={!!field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                disabled={isSubmitting}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${fieldId}-error` : undefined}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <label
                htmlFor={fieldId}
                className="text-sm font-medium text-gray-700"
              >
                {label}
                {isRequired && (
                  <span className="ml-0.5 text-red-500" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
            </div>
          )}
        />
        {property.description && (
          <p className="text-xs text-gray-500 ml-6">{property.description}</p>
        )}
        {error && (
          <p
            id={`${fieldId}-error`}
            className="text-sm text-red-600"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  // Number / integer field → number input
  if (property.type === 'number' || property.type === 'integer') {
    return (
      <div key={fieldKey} className="flex flex-col gap-1">
        <Controller
          name={fieldKey}
          control={control}
          render={({ field }) => (
            <Input
              id={fieldId}
              type="number"
              label={label}
              required={isRequired}
              error={error}
              disabled={isSubmitting}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
              onBlur={field.onBlur}
            />
          )}
        />
        {property.description && (
          <p className="text-xs text-gray-500">{property.description}</p>
        )}
      </div>
    );
  }

  // Default: string field → text input
  return (
    <div key={fieldKey} className="flex flex-col gap-1">
      <Controller
        name={fieldKey}
        control={control}
        render={({ field }) => (
          <Input
            id={fieldId}
            type="text"
            label={label}
            required={isRequired}
            error={error}
            disabled={isSubmitting}
            value={field.value ?? ''}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      {property.description && (
        <p className="text-xs text-gray-500">{property.description}</p>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

/**
 * ComplianceFormRenderer
 *
 * Dynamically renders a form from a JSON schema (ruleSet.jsonSchema).
 * Pre-populates with current rule values (ruleSet.rules).
 * Uses React Hook Form + Zod for validation.
 *
 * The parent controls submission via the `submitTrigger` prop and
 * listens for validated values via `onSubmit`. Use `onChange` to track
 * dirty state for unsaved-changes detection.
 *
 * Requirements: 5.2, 5.3, 5.4
 */
export function ComplianceFormRenderer({
  ruleSet,
  onSubmit,
  onChange,
  isSubmitting = false,
  submitTrigger,
}: ComplianceFormRendererProps) {
  const schema = ruleSet.jsonSchema as unknown as JsonSchemaObject;
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  // Build Zod schema from JSON schema (memoised per ruleSet change)
  const zodSchema = useMemo(() => buildZodSchema(ruleSet.jsonSchema), [ruleSet.jsonSchema]);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues: ruleSet.rules as Record<string, unknown>,
    mode: 'onBlur',
  });

  // Re-initialise form when ruleSet changes (different channel selected)
  useEffect(() => {
    reset(ruleSet.rules as Record<string, unknown>);
  }, [ruleSet.channelId, ruleSet.rules, reset]);

  // Notify parent of value changes for dirty-state tracking
  const watchedValues = watch();
  useEffect(() => {
    onChange?.(watchedValues);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(watchedValues), onChange]);

  // External submit trigger from Save button in parent page
  useEffect(() => {
    if (submitTrigger !== undefined && submitTrigger > 0) {
      handleSubmit(
        (values) => onSubmit(values as Record<string, unknown>),
        // On invalid: errors are already shown by react-hook-form state
        () => {}
      )();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitTrigger]);

  if (Object.keys(properties).length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No configurable fields defined in schema.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(
        (values) => onSubmit(values as Record<string, unknown>),
        () => {}
      )}
      noValidate
      aria-label={`Compliance rules for ${ruleSet.channelName}`}
      className="space-y-5"
    >
      {Object.entries(properties).map(([key, prop]) => (
        <FieldRenderer
          key={key}
          fieldKey={key}
          property={prop as JsonSchemaProperty}
          isRequired={required.includes(key)}
          control={control}
          error={(errors[key]?.message as string | undefined)}
          isSubmitting={isSubmitting}
        />
      ))}
    </form>
  );
}
