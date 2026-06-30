'use client';

import React from 'react';
import {
  FormProvider,
  type UseFormReturn,
  type FieldValues,
  type SubmitHandler,
} from 'react-hook-form';

export interface FormProps<TFieldValues extends FieldValues = FieldValues> {
  /** React Hook Form methods (from useForm with zodResolver) */
  form: UseFormReturn<TFieldValues>;
  /** Submit handler called when form validation passes */
  onSubmit: SubmitHandler<TFieldValues>;
  /** Form content (FormField components) */
  children: React.ReactNode;
  /** Additional className for the form element */
  className?: string;
  /** aria-label for the form */
  'aria-label'?: string;
  /** aria-labelledby for custom label association */
  'aria-labelledby'?: string;
}

/**
 * Form - Wrapper that provides React Hook Form context to child FormField components.
 * Use with Zod schemas via @hookform/resolvers/zod for type-safe validation.
 *
 * Usage:
 * ```tsx
 * const schema = z.object({ name: z.string().min(1) });
 * type FormData = z.infer<typeof schema>;
 *
 * const form = useForm<FormData>({ resolver: zodResolver(schema) });
 *
 * <Form form={form} onSubmit={handleSubmit}>
 *   <FormField name="name" label="Name" required>
 *     {({ field }) => <Input {...field} />}
 *   </FormField>
 * </Form>
 * ```
 */
export function Form<TFieldValues extends FieldValues = FieldValues>({
  form,
  onSubmit,
  children,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: FormProps<TFieldValues>) {
  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className={className}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        {children}
      </form>
    </FormProvider>
  );
}
