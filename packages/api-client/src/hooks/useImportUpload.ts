'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { ApiError } from '../errors';
import { normalizeError } from '../errors';
import { useSupplierClient } from '../context';
import { supplierKeys } from './useSuppliers';
import { importJobKeys } from './useImportJobs';

/**
 * Supplier import triggers.
 *
 * File and image imports upload directly to S3:
 *   1. POST /suppliers/{id}/imports/{file|images}  -> job (AWAITING_UPLOAD) + presigned PUT URL(s)
 *   2. PUT each file straight to S3 with the returned URL and headers
 *   3. POST /imports/{importJobId}/start           -> the API verifies the upload, then queues it
 * URL imports need no upload and start immediately.
 */

interface UploadInstruction {
  key: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

interface StagedImport {
  importJobId: string;
  status: string;
  uploads: UploadInstruction[];
  startUrl: string;
}

export interface StartedImport {
  importJobId: string;
  status: string;
}

/**
 * Uploads one file to its presigned URL. Uses plain fetch, NOT the API client:
 * the API client adds an Authorization header, which S3 would reject (the URL
 * carries its own signature) and which the bucket CORS rule does not allow.
 */
async function putToS3(upload: UploadInstruction, file: File): Promise<void> {
  let res: Response;
  try {
    res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  } catch {
    throw { statusCode: 0, message: 'The upload failed. Check your connection and try again.', requestId: '', code: 'UPLOAD_FAILED' } satisfies ApiError;
  }
  if (!res.ok) {
    throw {
      statusCode: res.status,
      message:
        res.status === 403
          ? 'The upload link expired or the file changed. Please try again.'
          : 'The upload failed. Please try again.',
      requestId: '',
      code: 'UPLOAD_FAILED',
    } satisfies ApiError;
  }
}

/** Maps a browser File's type to what the API accepts (browsers report CSV inconsistently). */
export function importContentType(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return 'text/csv';
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.zip')) return 'application/zip';
  return file.type;
}

function useInvalidateImports(supplierId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: supplierKeys.all });
    void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
  };
}

/** Starts one import per file (the API takes one file per import job). */
export function useStartFileImport(
  supplierId: string
): UseMutationResult<StartedImport[], ApiError, File[]> {
  const client = useSupplierClient();
  const invalidate = useInvalidateImports(supplierId);
  return useMutation<StartedImport[], ApiError, File[]>({
    mutationFn: async (files) => {
      const started: StartedImport[] = [];
      for (const file of files) {
        try {
          const { data } = await client.post<StagedImport>(
            `/suppliers/${encodeURIComponent(supplierId)}/imports/file`,
            { fileName: file.name, contentType: importContentType(file), fileSizeBytes: file.size }
          );
          await putToS3(data.uploads[0]!, file);
          const { data: begun } = await client.post<StartedImport>(data.startUrl);
          started.push(begun);
        } catch (error) {
          throw normalizeError(error);
        }
      }
      return started;
    },
    onSettled: invalidate,
  });
}

/** Uploads up to 50 images as ONE import job. */
export function useStartImageImport(
  supplierId: string
): UseMutationResult<StartedImport, ApiError, File[]> {
  const client = useSupplierClient();
  const invalidate = useInvalidateImports(supplierId);
  return useMutation<StartedImport, ApiError, File[]>({
    mutationFn: async (files) => {
      try {
        const { data } = await client.post<StagedImport>(
          `/suppliers/${encodeURIComponent(supplierId)}/imports/images`,
          { images: files.map((f) => ({ fileName: f.name, contentType: f.type, fileSizeBytes: f.size })) }
        );
        // Upload in parallel; the API returns one instruction per file, in order.
        await Promise.all(data.uploads.map((u, i) => putToS3(u, files[i]!)));
        const { data: begun } = await client.post<StartedImport>(data.startUrl);
        return begun;
      } catch (error) {
        throw normalizeError(error);
      }
    },
    onSettled: invalidate,
  });
}

export function useStartUrlImport(
  supplierId: string
): UseMutationResult<StartedImport, ApiError, { url: string; crawlDepth?: number }> {
  const client = useSupplierClient();
  const invalidate = useInvalidateImports(supplierId);
  return useMutation<StartedImport, ApiError, { url: string; crawlDepth?: number }>({
    mutationFn: async (payload) => {
      const { data } = await client.post<StartedImport>(
        `/suppliers/${encodeURIComponent(supplierId)}/imports/url`,
        payload
      );
      return data;
    },
    onSettled: invalidate,
  });
}
