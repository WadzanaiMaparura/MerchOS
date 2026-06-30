'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Maximum number of visible toasts. Defaults to 3. */
  maxVisible?: number;
  /** Default auto-dismiss duration in ms. Defaults to 8000. */
  defaultDuration?: number;
}

interface ToastContextValue {
  /** Show a toast notification */
  toast: (item: Omit<ToastItem, 'id'>) => void;
  /** Dismiss a specific toast */
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * useToast - Hook to access the toast context for showing/dismissing toasts.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  info: 'border-blue-500 bg-white',
  success: 'border-green-500 bg-white',
  warning: 'border-yellow-500 bg-white',
  error: 'border-red-500 bg-white',
};

/**
 * ToastProvider - Accessible toast system built on Radix Toast.
 * Uses ARIA live regions for screen reader announcements.
 * Supports max 3 visible toasts (oldest dismissed first) and auto-dismiss (8 seconds).
 */
export function ToastProvider({
  children,
  maxVisible = 3,
  defaultDuration = 8000,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const toast = useCallback(
    (item: Omit<ToastItem, 'id'>) => {
      const id = `toast-${++counterRef.current}`;
      const newToast: ToastItem = {
        ...item,
        id,
        duration: item.duration ?? defaultDuration,
      };

      setToasts((prev) => {
        const updated = [...prev, newToast];
        // Enforce max visible: remove oldest if exceeding limit
        if (updated.length > maxVisible) {
          return updated.slice(updated.length - maxVisible);
        }
        return updated;
      });
    },
    [defaultDuration, maxVisible]
  );

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            open={true}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            duration={item.duration}
            className={`rounded-lg border-l-4 p-4 shadow-md ${
              VARIANT_STYLES[item.variant ?? 'info']
            } data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <ToastPrimitive.Title className="text-sm font-semibold text-gray-900">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description && (
                  <ToastPrimitive.Description className="mt-1 text-sm text-gray-600">
                    {item.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close
                className="rounded-sm p-1 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                aria-label="Dismiss notification"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </ToastPrimitive.Close>
            </div>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport
          className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
          aria-live="polite"
          aria-label="Notifications"
        />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
