'use client';

import React, { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useProduct, useUpdateProduct, useApproveAttribute, useOverrideAttribute } from '@merch-os/api-client';
import { useRole, useAuth } from '@merch-os/auth';
import {
  Card,
  Badge,
  LifecycleBadge,
  ComplianceBadge,
  Input,
  Alert,
} from '@merch-os/ui';
import type {
  Product,
  EnrichedAttribute,
  ComplianceReport,
  CategoryMapping,
  Variant,
  ChannelId,
} from '@merch-os/types';
import { ProductImageGallery } from './components/ImageGallery';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EditingField {
  name: string;
  value: string;
  originalValue: string;
}

// ─── Helper: Channel display name ───────────────────────────────────────────

const CHANNEL_LABELS: Record<ChannelId, string> = {
  takealot: 'Takealot',
  amazon: 'Amazon',
  makro: 'Makro',
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  custom: 'Custom',
};

// ─── Product Detail Page ─────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const params = useParams<{ productId: string }>();
  const productId = params.productId;
  const role = useRole();
  const { user } = useAuth();

  const { data: product, isLoading, error } = useProduct(productId);
  const updateProduct = useUpdateProduct();
  const approveAttribute = useApproveAttribute();
  const overrideAttribute = useOverrideAttribute();

  // Track inline editing state
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [unsavedChanges, setUnsavedChanges] = useState<Record<string, string>>({});

  const canEdit = role === 'editor' || role === 'admin' || role === 'owner';

  // ─── Inline Attribute Editing ────────────────────────────────────────────

  const handleStartEdit = useCallback((name: string, currentValue: string) => {
    setEditingField({ name, value: unsavedChanges[name] ?? currentValue, originalValue: currentValue });
    setEditError(null);
  }, [unsavedChanges]);

  const handleEditChange = useCallback((value: string) => {
    setEditingField((prev) => prev ? { ...prev, value } : null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    // Retain unsaved changes so user doesn't lose input
    if (editingField) {
      setUnsavedChanges((prev) => ({ ...prev, [editingField.name]: editingField.value }));
    }
    setEditingField(null);
    setEditError(null);
  }, [editingField]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingField || !product) return;

    setEditError(null);

    try {
      await updateProduct.mutateAsync({
        productId: product.productId,
        attributeName: editingField.name,
        value: editingField.value,
      });
      // Clear unsaved changes for this field on success
      setUnsavedChanges((prev) => {
        const next = { ...prev };
        delete next[editingField.name];
        return next;
      });
      setEditingField(null);
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : 'Failed to update attribute. Please try again.';
      setEditError(message);
      // Revert field to previous value (optimistic rollback happens via React Query)
      // Retain unsaved changes in form so user doesn't lose input
      setUnsavedChanges((prev) => ({ ...prev, [editingField.name]: editingField.value }));
    }
  }, [editingField, product, updateProduct]);

  // ─── AI Attribute Approval ───────────────────────────────────────────────

  const handleApproveAttribute = useCallback(async (attributeName: string) => {
    if (!product) return;

    try {
      await approveAttribute.mutateAsync({
        productId: product.productId,
        attributeName,
        approvedBy: user?.userId,
      });
    } catch {
      // Error handled by React Query rollback
    }
  }, [product, approveAttribute, user]);

  // ─── AI Attribute Override ─────────────────────────────────────────────────

  const handleOverrideAttribute = useCallback(async (attributeName: string, newValue: string) => {
    if (!product) return;

    // Let the error propagate to the calling component so it can retain unsaved changes
    await overrideAttribute.mutateAsync({
      productId: product.productId,
      attributeName,
      newValue,
    });
  }, [product, overrideAttribute]);

  // ─── Loading / Error States ──────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="error" title="Failed to load product">
        {error.message || 'An error occurred while loading the product details.'}
      </Alert>
    );
  }

  if (!product) {
    return (
      <Alert variant="warning" title="Product not found">
        The requested product could not be found.
      </Alert>
    );
  }

  return (
    <article className="flex flex-col gap-6" aria-label={`Product: ${product.title}`}>
      {/* Page Header */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{product.title}</h1>
          <p className="mt-1 text-sm text-gray-500">SKU: {product.sku}</p>
        </div>
        <LifecycleBadge state={product.lifecycleState} />
      </header>

      {/* Edit Error Alert */}
      {editError && (
        <div aria-live="assertive">
          <Alert variant="error" title="Update failed" dismissible onDismiss={() => setEditError(null)}>
            {editError}
          </Alert>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Main Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Canonical Fields */}
          <CanonicalFieldsSection
            product={product}
            canEdit={canEdit}
            editingField={editingField}
            unsavedChanges={unsavedChanges}
            onStartEdit={handleStartEdit}
            onEditChange={handleEditChange}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            isSaving={updateProduct.isPending}
          />

          {/* Variants */}
          <VariantsSection variants={product.variants ?? []} />

          {/* Enrichment Layer */}
          {product.enrichmentLayer && (
            <EnrichmentSection
              enrichmentLayer={product.enrichmentLayer}
              canEdit={canEdit}
              onApprove={handleApproveAttribute}
              onOverride={handleOverrideAttribute}
              isApproving={approveAttribute.isPending}
              isOverriding={overrideAttribute.isPending}
              userId={user?.userId}
            />
          )}
        </div>

        {/* Right Column: Images, Categories, Compliance */}
        <div className="space-y-6">
          {/* Image Gallery */}
          <ProductImageGallery productId={product.productId} images={product.images ?? []} />

          {/* Category Mappings */}
          <CategoryMappingsSection categoryMappings={product.categoryMappings ?? {}} />

          {/* Compliance Reports */}
          <ComplianceReportsSection complianceReports={product.complianceReports ?? {}} />
        </div>
      </div>
    </article>
  );
}

// ─── Canonical Fields Section ────────────────────────────────────────────────

interface CanonicalFieldsSectionProps {
  product: Product;
  canEdit: boolean;
  editingField: EditingField | null;
  unsavedChanges: Record<string, string>;
  onStartEdit: (name: string, value: string) => void;
  onEditChange: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isSaving: boolean;
}

function CanonicalFieldsSection({
  product,
  canEdit,
  editingField,
  unsavedChanges,
  onStartEdit,
  onEditChange,
  onSaveEdit,
  onCancelEdit,
  isSaving,
}: CanonicalFieldsSectionProps) {
  const canonicalFields = [
    { key: 'title', label: 'Title', value: product.title },
    { key: 'description', label: 'Description', value: product.description },
    { key: 'brand', label: 'Brand', value: product.brand },
  ];

  return (
    <Card title="Product Details">
      <dl className="divide-y divide-gray-100">
        {/* SKU is read-only */}
        <div className="flex items-start gap-4 py-3">
          <dt className="w-32 flex-shrink-0 text-sm font-medium text-gray-500">SKU</dt>
          <dd className="flex-1 text-sm text-gray-900">{product.sku}</dd>
        </div>

        {canonicalFields.map(({ key, label, value }) => {
          const isEditing = editingField?.name === key;
          const hasUnsaved = key in unsavedChanges;

          return (
            <div key={key} className="flex items-start gap-4 py-3">
              <dt className="w-32 flex-shrink-0 text-sm font-medium text-gray-500">
                {label}
                {hasUnsaved && !isEditing && (
                  <span className="ml-1 text-xs text-amber-600" title="Unsaved changes">(modified)</span>
                )}
              </dt>
              <dd className="flex-1">
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <Input
                      value={editingField.value}
                      onChange={(e) => onEditChange(e.target.value)}
                      aria-label={`Edit ${label}`}
                      disabled={isSaving}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={onSaveEdit}
                        disabled={isSaving}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={onCancelEdit}
                        disabled={isSaving}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-gray-900">{String(value)}</span>
                    {canEdit && (
                      <button
                        onClick={() => onStartEdit(key, String(value))}
                        className="flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                        aria-label={`Edit ${label}`}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}
              </dd>
            </div>
          );
        })}

        {/* Custom Attributes */}
        {Object.entries(product.attributes).length > 0 && (
          <>
            <div className="pt-3 pb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Attributes</span>
            </div>
            {Object.entries(product.attributes).map(([attrKey, attrValue]) => {
              const isEditing = editingField?.name === attrKey;
              const hasUnsaved = attrKey in unsavedChanges;

              return (
                <div key={attrKey} className="flex items-start gap-4 py-3">
                  <dt className="w-32 flex-shrink-0 text-sm font-medium text-gray-500">
                    {attrKey}
                    {hasUnsaved && !isEditing && (
                      <span className="ml-1 text-xs text-amber-600">(modified)</span>
                    )}
                  </dt>
                  <dd className="flex-1">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <Input
                          value={editingField.value}
                          onChange={(e) => onEditChange(e.target.value)}
                          aria-label={`Edit ${attrKey}`}
                          disabled={isSaving}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={onSaveEdit}
                            disabled={isSaving}
                            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                          >
                            {isSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={onCancelEdit}
                            disabled={isSaving}
                            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm text-gray-900">{String(attrValue)}</span>
                        {canEdit && (
                          <button
                            onClick={() => onStartEdit(attrKey, String(attrValue))}
                            className="flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                            aria-label={`Edit ${attrKey}`}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </dd>
                </div>
              );
            })}
          </>
        )}
      </dl>
    </Card>
  );
}

// ─── Variants Section ────────────────────────────────────────────────────────

interface VariantsSectionProps {
  variants: Variant[];
}

function VariantsSection({ variants }: VariantsSectionProps) {
  if (!variants || variants.length === 0) return null;

  return (
    <section aria-labelledby="variants-heading">
      <Card title="Variants">
        <h3 id="variants-heading" className="sr-only">Variants</h3>
        <div className="divide-y divide-gray-100">
          {variants.map((variant) => (
            <div key={variant.variantId} className="py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  SKU: {variant.sku}
                </span>
                <span className="text-xs text-gray-500">
                  Stock: {variant.inventory.available} available
                </span>
              </div>
              {Object.keys(variant.attributes).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.entries(variant.attributes).map(([key, val]) => (
                    <Badge key={key} variant="neutral">
                      {key}: {val}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="mt-1 text-xs text-gray-500">
                On-hand: {variant.inventory.onHand} | Reserved: {variant.inventory.reserved} | Available: {variant.inventory.available}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

// ─── Enrichment Layer Section ────────────────────────────────────────────────

interface EnrichmentSectionProps {
  enrichmentLayer: Product['enrichmentLayer'];
  canEdit: boolean;
  onApprove: (attributeName: string) => void;
  onOverride: (attributeName: string, newValue: string) => Promise<void>;
  isApproving: boolean;
  isOverriding: boolean;
  userId?: string;
}

function EnrichmentSection({ enrichmentLayer, canEdit, onApprove, onOverride, isApproving, isOverriding, userId }: EnrichmentSectionProps) {
  const attributes = enrichmentLayer?.attributes ?? {};
  const attributeEntries = Object.entries(attributes);

  if (attributeEntries.length === 0) return null;

  return (
    <section aria-labelledby="enrichment-heading">
      <Card title="AI Enrichment">
        <h3 id="enrichment-heading" className="sr-only">AI Enrichment</h3>
        <p className="mb-3 text-xs text-gray-500">
          Enriched at: {formatDateTime(enrichmentLayer.enrichedAt)} | Language: {enrichmentLayer.detectedLanguage}
        </p>
        <div className="divide-y divide-gray-100">
          {attributeEntries.map(([name, attr]) => (
            <EnrichedAttributeRow
              key={name}
              name={name}
              attribute={attr}
              canEdit={canEdit}
              onApprove={() => onApprove(name)}
              onOverride={async (newValue) => onOverride(name, newValue)}
              isApproving={isApproving}
              isOverriding={isOverriding}
              userId={userId}
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

interface EnrichedAttributeRowProps {
  name: string;
  attribute: EnrichedAttribute;
  canEdit: boolean;
  onApprove: () => void;
  onOverride: (newValue: string) => Promise<void>;
  isApproving: boolean;
  isOverriding: boolean;
  userId?: string;
}

function EnrichedAttributeRow({ name, attribute, canEdit, onApprove, onOverride, isApproving, isOverriding, userId }: EnrichedAttributeRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(attribute.value));
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const confidencePercent = Math.round(attribute.confidence * 100);
  const confidenceColor =
    confidencePercent >= 80 ? 'text-green-700' :
    confidencePercent >= 50 ? 'text-yellow-700' :
    'text-red-700';

  const handleSaveOverride = useCallback(async () => {
    setOverrideError(null);
    try {
      await onOverride(editValue);
      setIsEditing(false);
    } catch (err: unknown) {
      // On error: display error message, revert to previous value, retain unsaved changes in form
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : 'Failed to override attribute. Please try again.';
      setOverrideError(message);
      // Keep isEditing true so user retains their input (requirement 5.7)
    }
  }, [editValue, onOverride]);

  const handleCancelOverride = useCallback(() => {
    setEditValue(String(attribute.value));
    setOverrideError(null);
    setIsEditing(false);
  }, [attribute.value]);

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{name}</span>
            {attribute.flaggedForReview && (
              <Badge variant="warning">Review</Badge>
            )}
            {attribute.approvedBy && (
              <Badge variant="success">Approved</Badge>
            )}
          </div>
          {isEditing ? (
            <div className="mt-1 flex flex-col gap-2">
              {overrideError && (
                <div aria-live="assertive">
                  <Alert variant="error" dismissible onDismiss={() => setOverrideError(null)}>
                    {overrideError}
                  </Alert>
                </div>
              )}
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                aria-label={`Override ${name} value`}
                disabled={isOverriding}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveOverride}
                  disabled={isOverriding}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  {isOverriding ? 'Saving...' : 'Save Override'}
                </button>
                <button
                  onClick={handleCancelOverride}
                  disabled={isOverriding}
                  className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 text-sm text-gray-700">{String(attribute.value)}</p>
          )}
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
            <span className={confidenceColor}>
              Confidence: {confidencePercent}%
            </span>
            <span>Source: {attribute.source}</span>
            {attribute.approvedBy && (
              <span>Approved by: {attribute.approvedBy}</span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          {canEdit && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              aria-label={`Override ${name} attribute`}
            >
              Override
            </button>
          )}
          {canEdit && attribute.flaggedForReview && !isEditing && (
            <button
              onClick={onApprove}
              disabled={isApproving}
              className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:opacity-50"
              aria-label={`Approve ${name} attribute`}
            >
              {isApproving ? 'Approving...' : 'Approve'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Category Mappings Section ───────────────────────────────────────────────

interface CategoryMappingsSectionProps {
  categoryMappings: Partial<Record<ChannelId, CategoryMapping>>;
}

function CategoryMappingsSection({ categoryMappings }: CategoryMappingsSectionProps) {
  const entries = Object.entries(categoryMappings) as [ChannelId, CategoryMapping][];

  if (entries.length === 0) {
    return (
      <Card title="Category Mappings">
        <p className="text-sm text-gray-500">No category mappings available.</p>
      </Card>
    );
  }

  return (
    <Card title="Category Mappings">
      <div className="divide-y divide-gray-100">
        {entries.map(([channelId, mapping]) => (
          <div key={channelId} className="py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">
                {CHANNEL_LABELS[channelId]}
              </span>
              {mapping.confirmedNodeId && (
                <Badge variant="success">Confirmed</Badge>
              )}
            </div>
            {mapping.recommendedNodes.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {mapping.recommendedNodes.map((node) => (
                  <div key={node.nodeId} className="flex items-center justify-between text-xs text-gray-600">
                    <span>{node.nodeId}</span>
                    <span className="text-gray-400">{Math.round(node.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
            {mapping.confirmedBy && (
              <p className="mt-1 text-xs text-gray-400">
                Confirmed by {mapping.confirmedBy} at {formatDateTime(mapping.confirmedAt ?? '')}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Compliance Reports Section ──────────────────────────────────────────────

interface ComplianceReportsSectionProps {
  complianceReports: Partial<Record<ChannelId, ComplianceReport>>;
}

function ComplianceReportsSection({ complianceReports }: ComplianceReportsSectionProps) {
  const entries = Object.entries(complianceReports) as [ChannelId, ComplianceReport][];

  if (entries.length === 0) {
    return (
      <Card title="Compliance Reports">
        <p className="text-sm text-gray-500">No compliance reports available.</p>
      </Card>
    );
  }

  return (
    <Card title="Compliance Reports">
      <div className="divide-y divide-gray-100">
        {entries.map(([channelId, report]) => (
          <div key={channelId} className="py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">
                {CHANNEL_LABELS[channelId]}
              </span>
              <ComplianceBadge status={report.result} />
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              Rule set v{report.ruleSetVersion} | Evaluated: {formatDateTime(report.evaluatedAt)}
            </p>
            {report.violations.length > 0 && (
              <div className="mt-2 space-y-1">
                {report.violations.map((violation, idx) => (
                  <div key={idx} className="rounded bg-red-50 p-2 text-xs text-red-700">
                    <span className="font-medium">{violation.violationCode}</span>: {violation.remediation}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}
