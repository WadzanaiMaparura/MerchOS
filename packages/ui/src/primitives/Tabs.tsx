'use client';

import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

export interface TabItem {
  /** Unique value identifying this tab */
  value: string;
  /** Display label for the tab trigger */
  label: string;
  /** Tab panel content */
  content: React.ReactNode;
  /** Whether this tab is disabled */
  disabled?: boolean;
}

export interface TabsProps {
  /** List of tab items */
  tabs: TabItem[];
  /** Currently active tab value */
  defaultValue?: string;
  /** Controlled value */
  value?: string;
  /** Callback when active tab changes */
  onValueChange?: (value: string) => void;
  /** Accessible label for the tab list */
  ariaLabel?: string;
}

/**
 * Tabs - Accessible tabbed interface built on Radix Tabs.
 * Supports full keyboard navigation (Arrow keys, Home, End).
 * Tab panels are lazy-mounted for performance.
 */
export function Tabs({
  tabs,
  defaultValue,
  value,
  onValueChange,
  ariaLabel = 'Tabs',
}: TabsProps) {
  const resolvedDefault = defaultValue ?? tabs[0]?.value;

  return (
    <TabsPrimitive.Root
      defaultValue={resolvedDefault}
      value={value}
      onValueChange={onValueChange}
      className="w-full"
    >
      <TabsPrimitive.List
        className="flex border-b border-gray-200"
        aria-label={ariaLabel}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled}
            className="relative px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:text-blue-600 data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-blue-600"
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content
          key={tab.value}
          value={tab.value}
          className="mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
