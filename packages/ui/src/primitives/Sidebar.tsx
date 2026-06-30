'use client';

import React, { useState, useCallback } from 'react';
import * as NavigationMenu from '@radix-ui/react-navigation-menu';

export interface SidebarItem {
  /** Display label for the navigation item */
  label: string;
  /** Navigation href */
  href: string;
  /** Icon component rendered in both collapsed and expanded modes */
  icon: React.ReactNode;
  /** Whether this item is currently active */
  active?: boolean;
  /** Optional badge count (e.g., pending items) */
  badge?: number;
}

export interface SidebarProps {
  /** Navigation items to display */
  items: SidebarItem[];
  /** Whether the sidebar is collapsed to icon-only mode */
  collapsed?: boolean;
  /** Callback when collapse toggle is clicked */
  onToggleCollapse?: () => void;
  /** Callback when a navigation item is clicked */
  onNavigate?: (href: string) => void;
}

/**
 * Sidebar - Accessible navigation sidebar built on Radix NavigationMenu.
 * Supports keyboard navigation, active state indication with vertical accent,
 * and collapse toggle to icon-only mode.
 */
export function Sidebar({
  items,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
}: SidebarProps) {
  return (
    <aside
      className={`flex flex-col h-full bg-sidebar-bg text-white transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
      aria-label="Main navigation"
    >
      <NavigationMenu.Root
        orientation="vertical"
        className="flex-1 flex flex-col"
      >
        <NavigationMenu.List className="flex flex-col gap-1 p-2">
          {items.map((item) => (
            <NavigationMenu.Item key={item.href}>
              <NavigationMenu.Link
                href={item.href}
                active={item.active}
                onClick={(e) => {
                  if (onNavigate) {
                    e.preventDefault();
                    onNavigate(item.href);
                  }
                }}
                className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar-bg
                  ${
                    item.active
                      ? 'bg-sidebar-active text-white'
                      : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
                  }
                `}
                aria-current={item.active ? 'page' : undefined}
              >
                {/* Vertical accent indicator for active item */}
                {item.active && (
                  <span
                    className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-sidebar-accent"
                    aria-hidden="true"
                  />
                )}
                <span className="flex-shrink-0 w-5 h-5" aria-hidden="true">
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
                {!collapsed && item.badge !== undefined && item.badge > 0 && (
                  <span
                    className="ml-auto inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-blue-600 text-white rounded-full"
                    aria-label={`${item.badge} pending`}
                  >
                    {item.badge}
                  </span>
                )}
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          ))}
        </NavigationMenu.List>
      </NavigationMenu.Root>

      {/* Collapse toggle button */}
      <div className="p-2 border-t border-gray-700">
        <button
          onClick={onToggleCollapse}
          className="flex items-center justify-center w-full p-2 rounded-md text-gray-400 hover:text-white hover:bg-sidebar-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar-bg"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`w-5 h-5 transition-transform ${collapsed ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
            />
          </svg>
        </button>
      </div>
    </aside>
  );
}
