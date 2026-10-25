/**
 * React Query hooks for the Image Intelligence Engine (async image pipeline).
 *
 * Drives the engine's flow:
 *   1. useRequestUploadUrl  → POST /v1/images/upload  (presigned S3 PUT)
 *   2. (browser PUTs the file directly to S3)
 *   3. useStartImageProcessing → POST /v1/images/{productId}/process → 202 {imageJobId}
 *   4. useImageJob(imageJobId) → GET /v1/images/{imageJobId}  (polls until terminal)
 *   5. useImageSignedUrl(imageId, channel) → GET /v1/images/{imageId}/url/{channel}
 *
 * This replaces the earlier synchronous multipart upload model; the engine does
 * moderation → hero → per-channel variants off the request path.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Image_Job lifecycle status from the engine. */
export type ImageJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

/** A per-channel processed image variant. */
export interface ImageVariant {
  channel: string;
  s3Key: string;
  width: number;
  height: number;
  upscaled: boolean;
}

/** Moderation outcome reported by the engine. */
export interface ImageModeration {
  passed: boolean;
  rejectedLabels?: string[];
}

/** Image_Job status response (GET /v1/images/{imageJobId}). */
export interface ImageJob {
  imageJobId: string;
  productId: string;
  status: ImageJobStatus;
  variants: ImageVariant[];
  moderation?: ImageModeration;
  enhancement?: { attempted: boolean; applied: boolean; skippedReason?: string };
  reviewRecommended: boolean;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

/** Presigned upload response (POST /v1/images/upload). */
export interface UploadUrlResponse {
  imageId: string;
  s3Key: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/** Signed delivery URL response (GET /v1/images/{imageId}/url/{channel}). */
export interface SignedUrlResponse {
  url: string;
  expiresInSeconds: number;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const imageKeys = {
  all: ['images'] as const,
  jobs: () => [...imageKeys.all, 'job'] as const,
  job: (imageJobId: string) => [...imageKeys.jobs(), imageJobId] as const,
  signedUrls: () => [...imageKeys.all, 'signed-url'] as const,
  signedUrl: (imageId: string, channel: string) =>
    [...imageKeys.signedUrls(), imageId, channel] as const,
};

/** Terminal Image_Job statuses — polling stops here. */
const TERMINAL_STATUSES: ReadonlySet<ImageJobStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'REJECTED',
]);

// ─── useRequestUploadUrl ─────────────────────────────────────────────────────

interface RequestUploadUrlPayload {
  productId: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
}

/**
 * Requests a presigned S3 PUT URL for a source image. The caller then PUTs the
 * file bytes directly to `uploadUrl` (S3), and afterwards calls
 * `useStartImageProcessing` with the returned `s3Key`.
 */
export function useRequestUploadUrl(): UseMutationResult<
  UploadUrlResponse,
  ApiError,
  RequestUploadUrlPayload
> {
  const client = useApiClient();
  return useMutation<UploadUrlResponse, ApiError, RequestUploadUrlPayload>({
    mutationFn: async (payload) => {
      const response = await client.post<UploadUrlResponse>('/v1/images/upload', payload);
      return response.data;
    },
  });
}

// ─── useStartImageProcessing ─────────────────────────────────────────────────

interface StartProcessingPayload {
  productId: string;
  /** Raw-uploads S3 keys returned from the presign step. */
  sourceKeys: string[];
}

interface StartProcessingResponse {
  imageJobId: string;
  status: ImageJobStatus;
}

/**
 * Starts the ImageProcessingWorkflow for already-uploaded source images.
 * Returns the imageJobId to poll with `useImageJob`.
 */
export function useStartImageProcessing(): UseMutationResult<
  StartProcessingResponse,
  ApiError,
  StartProcessingPayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<StartProcessingResponse, ApiError, StartProcessingPayload>({
    mutationFn: async (payload) => {
      const response = await client.post<StartProcessingResponse>(
        `/v1/images/${payload.productId}/process`,
        { sourceKeys: payload.sourceKeys },
      );
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: imageKeys.job(data.imageJobId) });
    },
  });
}

// ─── useImageJob (polling) ───────────────────────────────────────────────────

/**
 * Polls an Image_Job's status until it reaches a terminal state
 * (COMPLETED / FAILED / REJECTED). Pass `undefined` to disable the query.
 */
export function useImageJob(
  imageJobId: string | undefined,
): UseQueryResult<ImageJob, ApiError> {
  const client = useApiClient();
  return useQuery<ImageJob, ApiError>({
    queryKey: imageKeys.job(imageJobId ?? 'none'),
    enabled: Boolean(imageJobId),
    queryFn: async () => {
      const response = await client.get<ImageJob>(`/v1/images/${imageJobId}`);
      return response.data;
    },
    // Poll every 2s while the job is still in flight; stop once terminal.
    refetchInterval: (query) => {
      const data = query.state.data as ImageJob | undefined;
      if (data && TERMINAL_STATUSES.has(data.status)) {
        return false;
      }
      return 2000;
    },
  });
}

// ─── useImageSignedUrl ───────────────────────────────────────────────────────

/**
 * Fetches a short-lived (1-hour) CloudFront signed URL for a processed variant.
 * Cached for slightly under the TTL so the UI reuses it without re-signing.
 */
export function useImageSignedUrl(
  imageId: string | undefined,
  channel: string | undefined,
): UseQueryResult<SignedUrlResponse, ApiError> {
  const client = useApiClient();
  return useQuery<SignedUrlResponse, ApiError>({
    queryKey: imageKeys.signedUrl(imageId ?? 'none', channel ?? 'none'),
    enabled: Boolean(imageId && channel),
    staleTime: 55 * 60_000, // ~55 min (URL TTL is 60 min)
    gcTime: 60 * 60_000,
    queryFn: async () => {
      const response = await client.get<SignedUrlResponse>(
        `/v1/images/${imageId}/url/${channel}`,
      );
      return response.data;
    },
  });
}
