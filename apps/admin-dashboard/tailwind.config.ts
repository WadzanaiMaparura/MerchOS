import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        sidebar: {
          // Deeper light-grey sidebar: light surface, dark text, primary-blue active accent.
          // Matches the seller dashboard for cross-app brand consistency.
          bg: '#e5e7eb',      // gray-200 surface
          hover: '#d1d5db',   // gray-300 hover
          active: '#dbeafe',  // primary-100 tint for the active item
          accent: '#2563eb',  // primary-600 active accent bar
        },
        success: {
          50: '#f0fdf4',
          500: '#22c55e',
          700: '#15803d',
        },
        warning: {
          50: '#fffbeb',
          500: '#f59e0b',
          700: '#b45309',
        },
        danger: {
          50: '#fef2f2',
          500: '#ef4444',
          700: '#b91c1c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      spacing: {
        'sidebar-collapsed': '4rem',
        'sidebar-expanded': '16rem',
      },
      transitionProperty: {
        sidebar: 'width, padding, margin',
      },
    },
  },
  plugins: [],
};

export default config;
