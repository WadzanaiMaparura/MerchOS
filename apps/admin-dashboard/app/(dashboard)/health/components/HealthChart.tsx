'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { MetricSeries } from '@merch-os/types';

// ─── Colour Palette ───────────────────────────────────────────────────────────

const SERIES_COLOURS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Merges multiple MetricSeries into a flat array of record objects keyed by
 * series name, aligned on a common timestamp axis. Recharts requires all
 * series data to live in a single array of objects.
 */
function mergeSeriesData(
  seriesList: MetricSeries[]
): Record<string, string | number>[] {
  if (seriesList.length === 0) return [];

  // Collect all unique timestamps across all series
  const timestampSet = new Set<string>();
  for (const series of seriesList) {
    for (const dp of series.datapoints) {
      timestampSet.add(dp.timestamp);
    }
  }

  // Sort timestamps chronologically
  const sortedTimestamps = Array.from(timestampSet).sort();

  // Build lookup maps: seriesName → (timestamp → value)
  const lookupMaps = new Map<string, Map<string, number>>();
  for (const series of seriesList) {
    const map = new Map<string, number>();
    for (const dp of series.datapoints) {
      map.set(dp.timestamp, dp.value);
    }
    lookupMaps.set(series.name, map);
  }

  // Produce merged records
  return sortedTimestamps.map((ts) => {
    const record: Record<string, string | number> = { timestamp: ts };
    for (const series of seriesList) {
      record[series.name] = lookupMaps.get(series.name)?.get(ts) ?? 0;
    }
    return record;
  });
}

/**
 * Formats an ISO 8601 timestamp for the X-axis tick labels.
 * Shows HH:MM for intra-day data; shows MM/DD HH:MM for multi-day data.
 */
function formatAxisTick(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  return (
    date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' }) +
    ' ' +
    date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  unit: string;
}

function CustomTooltip({ active, payload, label, unit }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || !label) return null;

  // Format the label as a full ISO 8601 timestamp for display (Req 3.4)
  const isoTimestamp = new Date(label).toISOString();

  return (
    <div
      role="tooltip"
      className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-lg"
    >
      <p className="mb-1 text-xs font-medium text-gray-500">{isoTimestamp}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-sm font-semibold" style={{ color: entry.color }}>
          {entry.name}: {entry.value.toLocaleString()} {unit}
        </p>
      ))}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HealthChartProps {
  /** Chart heading displayed above the visualisation */
  title: string;
  /** One or more metric series to render */
  series: MetricSeries[];
  /** Unit label appended to values in the tooltip (e.g. "errors/min", "messages") */
  unit: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * HealthChart – Recharts AreaChart rendering one or more MetricSeries with
 * 5-minute interval data points.
 *
 * Requirements: 3.1, 3.4, 11.1
 */
export function HealthChart({ title, series, unit }: HealthChartProps) {
  const chartData = mergeSeriesData(series);
  const hasData = chartData.length > 0;

  const chartId = `health-chart-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <section
      aria-labelledby={`${chartId}-heading`}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3
        id={`${chartId}-heading`}
        className="mb-4 text-sm font-semibold text-gray-900"
      >
        {title}
      </h3>

      {!hasData ? (
        <div
          className="flex h-48 items-center justify-center text-sm text-gray-400"
          aria-label="No data available"
        >
          No data available for this time range.
        </div>
      ) : (
        <div
          role="img"
          aria-label={`${title} time-series chart. ${series.map((s) => `${s.name}: ${s.datapoints.length} data points`).join(', ')}.`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <defs>
                {series.map((s, i) => {
                  const colour = SERIES_COLOURS[i % SERIES_COLOURS.length];
                  return (
                    <linearGradient
                      key={s.name}
                      id={`gradient-${chartId}-${i}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor={colour} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={colour} stopOpacity={0} />
                    </linearGradient>
                  );
                })}
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />

              <XAxis
                dataKey="timestamp"
                tickFormatter={formatAxisTick}
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                minTickGap={40}
              />

              <YAxis
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                width={50}
                tickFormatter={(v: number) => v.toLocaleString()}
              />

              <Tooltip
                content={<CustomTooltip unit={unit} />}
                // Recharts passes active/payload/label automatically
              />

              {series.length > 1 && (
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                />
              )}

              {series.map((s, i) => {
                const colour = SERIES_COLOURS[i % SERIES_COLOURS.length];
                return (
                  <Area
                    key={s.name}
                    type="monotone"
                    dataKey={s.name}
                    stroke={colour}
                    strokeWidth={2}
                    fill={`url(#gradient-${chartId}-${i})`}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
