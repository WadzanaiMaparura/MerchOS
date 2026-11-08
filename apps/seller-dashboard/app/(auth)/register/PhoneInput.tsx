'use client';

/**
 * PhoneInput — searchable country-code picker + national-number field.
 *
 * Replaces the raw "+27..." text field on the registration form. The user
 * searches/selects their country (all countries, type-to-filter) and types only
 * the local number; the component emits a single E.164 value
 * (`+<dial><national digits>`) via onChange so the form/Zod schema and the
 * backend contract are unchanged.
 *
 * Self-contained (no Radix / no new dependency): a toggle button reveals an
 * absolutely-positioned panel with a search box and an all-countries list, with
 * outside-click + Escape to close.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { COUNTRIES, DEFAULT_COUNTRY_ISO, type Country } from './countries';

export interface PhoneInputProps {
  /** Current E.164 value (e.g. "+27831234567"), or '' when empty. */
  value: string;
  /** Emits the combined E.164 value on any change. */
  onChange: (e164: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** id for label association (applied to the national-number input). */
  id?: string;
}

/**
 * Split an E.164 value into the best-matching country + national digits.
 * Prefers the longest dial-code match so multi-digit codes win over short ones.
 */
function splitE164(value: string): { country: Country; national: string } {
  const digits = value.replace(/[^\d]/g, '');
  if (digits) {
    const byLenDesc = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    const match = byLenDesc.find((c) => digits.startsWith(c.dial));
    if (match) {
      return { country: match, national: digits.slice(match.dial.length) };
    }
  }
  const fallback = COUNTRIES.find((c) => c.iso === DEFAULT_COUNTRY_ISO) ?? COUNTRIES[0]!;
  return { country: fallback, national: '' };
}

export function PhoneInput({ value, onChange, onBlur, disabled, id }: PhoneInputProps) {
  const generatedId = useId();
  const listId = `${generatedId}-country-list`;

  const initial = useMemo(() => splitE164(value), [value]);
  const [country, setCountry] = useState<Country>(initial.country);
  const [national, setNational] = useState<string>(initial.national);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const emit = (c: Country, nationalDigits: string) => {
    const clean = nationalDigits.replace(/[^\d]/g, '');
    onChange(clean ? `+${c.dial}${clean}` : '');
  };

  const handleSelect = (c: Country) => {
    setCountry(c);
    setOpen(false);
    setQuery('');
    emit(c, national);
  };

  const handleNationalChange = (raw: string) => {
    const clean = raw.replace(/[^\d]/g, '');
    setNational(clean);
    emit(country, clean);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dial.includes(q.replace(/\D/g, '')),
    );
  }, [query]);

  return (
    <div ref={rootRef} className="relative flex items-stretch gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country code: ${country.name} +${country.dial}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="font-mono text-xs text-gray-500">{country.iso}</span>
        <span>+{country.dial}</span>
        <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <input
        id={id}
        type="text"
        inputMode="tel"
        autoComplete="tel-national"
        value={national}
        onChange={(e) => handleNationalChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        placeholder="83 123 4567"
        aria-label="Phone number (without country code)"
        className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country or code…"
              aria-label="Search country"
              aria-controls={listId}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-gray-500">No matches</li>
            ) : (
              filtered.map((c) => (
                <li key={c.iso}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.iso === country.iso}
                    onClick={() => handleSelect(c)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none ${
                      c.iso === country.iso ? 'bg-gray-50 font-medium' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span className="font-mono text-xs text-gray-400">{c.iso}</span>
                      <span className="truncate text-gray-900">{c.name}</span>
                    </span>
                    <span className="shrink-0 text-gray-500">+{c.dial}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
