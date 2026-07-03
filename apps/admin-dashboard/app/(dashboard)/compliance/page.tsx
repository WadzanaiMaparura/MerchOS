'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ComplianceChannelSummary, ComplianceRuleSet } from '@merch-os/types';
import {
  useComplianceChannels,
  useComplianceRuleSet,
  useSaveComplianceRules,
} from '@merch-os/api-client';
import { Alert, Badge, Card, Skeleton } from '@merch-os/ui';
import { ComplianceFormRenderer } from './components/ComplianceFormRenderer';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const CHANNEL_IDS = [
  'takealot',
  'amazon',
  'makro',
  'shopify',
  'woocommerce',
  'custom',
] as const;

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

/** Deep equality check for detecting unsaved changes. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keysA = Object.keys(aObj);
  const keysB = Object.keys(bObj);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => deepEqual(aObj[k], bObj[k]));
}

// ─── Channel List Item ─────────────────────────────────────────────────────────

interface ChannelListItemProps {
  channel: ComplianceChannelSummary;
  isSelected: boolean;
  onSelect: (channelId: string) => void;
  hasUnsavedChanges: boolean;
}

function ChannelListItem({
  channel,
  isSelected,
  onSelect,
  hasUnsavedChanges,
}: ChannelListItemProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(channel.channelId)}
      className={[
        'w-full rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
      ].join(' ')}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-900">{channel.channelName}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            v{channel.version} · Updated {formatTimestamp(channel.updatedAt)}
          </p>
        </div>
        {hasUnsavedChanges && isSelected && (
          <Badge variant="warning">Unsaved</Badge>
        )}
      </div>
    </button>
  );
}

// ─── Rule Set Panel Skeleton ───────────────────────────────────────────────────

function RuleSetSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading rule set" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-md" />
      ))}
    </div>
  );
}

// ─── Rule Set Panel ────────────────────────────────────────────────────────────

interface RuleSetPanelProps {
  channelId: string;
  onRuleSetLoaded: (ruleSet: ComplianceRuleSet) => void;
  onValuesChange: (values: Record<string, unknown>) => void;
  submitTrigger: number;
  onSubmitValidated: (values: Record<string, unknown>) => void;
  isSubmitting: boolean;
}

function RuleSetPanel({
  channelId,
  onRuleSetLoaded,
  onValuesChange,
  submitTrigger,
  onSubmitValidated,
  isSubmitting,
}: RuleSetPanelProps) {
  const { data: ruleSet, isLoading, isError, error, refetch } = useComplianceRuleSet(channelId);

  useEffect(() => {
    if (ruleSet) {
      onRuleSetLoaded(ruleSet);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleSet]);

  if (isLoading) {
    return <RuleSetSkeleton />;
  }

  if (isError) {
    return (
      <Alert variant="error" title="Failed to load rule set">
        {error?.message ?? 'An unexpected error occurred.'}{' '}
        <button
          type="button"
          onClick={() => refetch()}
          className="font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1"
        >
          Retry
        </button>
      </Alert>
    );
  }

  if (!ruleSet) {
    return null;
  }

  return (
    <ComplianceFormRenderer
      ruleSet={ruleSet}
      onSubmit={onSubmitValidated}
      onChange={onValuesChange}
      isSubmitting={isSubmitting}
      submitTrigger={submitTrigger}
    />
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * Compliance Rule Editor Page
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export default function CompliancePage() {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  // Tracks the loaded rule set for the selected channel (for version/timestamp display)
  const [loadedRuleSet, setLoadedRuleSet] = useState<ComplianceRuleSet | null>(null);

  // Tracks the last-saved form values for unsaved-changes detection
  const savedValuesRef = useRef<Record<string, unknown>>({});

  // Current form values (updated on every change)
  const [currentValues, setCurrentValues] = useState<Record<string, unknown>>({});

  // Submit trigger counter: incrementing it triggers the form's handleSubmit
  const [submitTrigger, setSubmitTrigger] = useState(0);

  // Success state after save
  const [savedRuleSet, setSavedRuleSet] = useState<ComplianceRuleSet | null>(null);

  // API error state (separate from form validation errors)
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    data: channels,
    isLoading: channelsLoading,
    isError: channelsError,
    error: channelsErrorMsg,
    refetch: refetchChannels,
  } = useComplianceChannels();

  const { mutate: saveRules, isPending: isSaving } = useSaveComplianceRules();

  // ─── Derived State ───────────────────────────────────────────────────────────

  const hasUnsavedChanges =
    loadedRuleSet !== null && !deepEqual(currentValues, savedValuesRef.current);

  // ─── Navigation Guard (beforeunload) ────────────────────────────────────────
  // Requirement 5.7: warn on navigation with unsaved changes

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        // Modern browsers show their own message; setting returnValue triggers the dialog
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      if (hasUnsavedChanges) {
        const confirmed = window.confirm(
          'You have unsaved changes. Are you sure you want to switch channels? Your changes will be lost.'
        );
        if (!confirmed) return;
      }
      // Reset state for new channel
      setSelectedChannelId(channelId);
      setLoadedRuleSet(null);
      setCurrentValues({});
      savedValuesRef.current = {};
      setSavedRuleSet(null);
      setApiError(null);
    },
    [hasUnsavedChanges]
  );

  const handleRuleSetLoaded = useCallback((ruleSet: ComplianceRuleSet) => {
    setLoadedRuleSet(ruleSet);
    // Initialise saved values to the loaded rule values
    savedValuesRef.current = ruleSet.rules as Record<string, unknown>;
    setCurrentValues(ruleSet.rules as Record<string, unknown>);
    setSavedRuleSet(null);
    setApiError(null);
  }, []);

  const handleValuesChange = useCallback((values: Record<string, unknown>) => {
    setCurrentValues(values);
  }, []);

  const handleSaveClick = useCallback(() => {
    if (!selectedChannelId) return;
    setSavedRuleSet(null);
    setApiError(null);
    // Increment trigger → ComplianceFormRenderer runs handleSubmit
    setSubmitTrigger((n) => n + 1);
  }, [selectedChannelId]);

  /** Called by ComplianceFormRenderer after Zod validation passes */
  const handleValidatedSubmit = useCallback(
    (values: Record<string, unknown>) => {
      if (!selectedChannelId) return;

      saveRules(
        { channelId: selectedChannelId, rules: values },
        {
          onSuccess: (updated) => {
            // Requirement 5.5: show updated version + timestamp
            setSavedRuleSet(updated);
            // Update saved reference so hasUnsavedChanges resets
            savedValuesRef.current = values;
            setApiError(null);
          },
          onError: (err) => {
            // Requirement 5.6: preserve unsaved changes, show error
            setApiError(err?.message ?? 'Failed to save compliance rules. Please try again.');
          },
        }
      );
    },
    [selectedChannelId, saveRules]
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Compliance Rules</h1>
        <p className="mt-1 text-sm text-gray-500">
          Edit per-channel compliance validation rules.
        </p>
      </div>

      {/* Channel list load error */}
      {channelsError && (
        <Alert variant="error" title="Failed to load channels" className="mb-6">
          {channelsErrorMsg?.message ?? 'An unexpected error occurred.'}{' '}
          <button
            type="button"
            onClick={() => refetchChannels()}
            className="font-medium underline hover:no-underline focus-visible:outline-none"
          >
            Retry
          </button>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* ── Channel list (left column) ── */}
        <aside aria-label="Compliance channels">
          <Card padding="sm">
            <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Channels
            </h2>

            {channelsLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading channels">
                {CHANNEL_IDS.map((id) => (
                  <Skeleton key={id} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-2" role="list">
                {(channels ?? []).map((channel) => (
                  <div key={channel.channelId} role="listitem">
                    <ChannelListItem
                      channel={channel}
                      isSelected={selectedChannelId === channel.channelId}
                      onSelect={handleChannelSelect}
                      hasUnsavedChanges={hasUnsavedChanges}
                    />
                  </div>
                ))}

                {!channelsLoading && !channelsError && (channels ?? []).length === 0 && (
                  <p className="px-1 text-sm text-gray-500">No channels found.</p>
                )}
              </div>
            )}
          </Card>
        </aside>

        {/* ── Rule set editor (right column) ── */}
        <main aria-label="Rule set editor">
          {selectedChannelId === null ? (
            <Card>
              <div className="flex h-48 items-center justify-center text-center">
                <p className="text-sm text-gray-500">
                  Select a channel from the list to edit its compliance rules.
                </p>
              </div>
            </Card>
          ) : (
            <Card
              title={
                loadedRuleSet
                  ? `${loadedRuleSet.channelName} — v${loadedRuleSet.version}`
                  : undefined
              }
              padding="lg"
            >
              {/* Success notification (Requirement 5.5) */}
              {savedRuleSet && (
                <Alert
                  variant="success"
                  title="Rules saved successfully"
                  dismissible
                  onDismiss={() => setSavedRuleSet(null)}
                  className="mb-5"
                  aria-live="polite"
                >
                  Updated to version <strong>{savedRuleSet.version}</strong> at{' '}
                  {formatTimestamp(savedRuleSet.updatedAt)}.
                </Alert>
              )}

              {/* API error (Requirement 5.6) */}
              {apiError && (
                <Alert
                  variant="error"
                  title="Save failed"
                  dismissible
                  onDismiss={() => setApiError(null)}
                  className="mb-5"
                  aria-live="assertive"
                >
                  {apiError}
                </Alert>
              )}

              {/* Rule set form */}
              <RuleSetPanel
                channelId={selectedChannelId}
                onRuleSetLoaded={handleRuleSetLoaded}
                onValuesChange={handleValuesChange}
                submitTrigger={submitTrigger}
                onSubmitValidated={handleValidatedSubmit}
                isSubmitting={isSaving}
              />

              {/* Save button */}
              {loadedRuleSet && (
                <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-5">
                  {hasUnsavedChanges ? (
                    <p className="text-xs text-amber-600" aria-live="polite">
                      You have unsaved changes.
                    </p>
                  ) : (
                    <span />
                  )}

                  <button
                    type="button"
                    onClick={handleSaveClick}
                    disabled={isSaving}
                    aria-busy={isSaving}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving && (
                      <svg
                        className="h-4 w-4 animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8H4z"
                        />
                      </svg>
                    )}
                    {isSaving ? 'Saving…' : 'Save Rules'}
                  </button>
                </div>
              )}
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
