import type { Metadata } from 'next';
import Script from 'next/script';
import { DM_Sans } from 'next/font/google';
import { Providers } from './providers';
import { ChatWidget } from './components/chat/ChatWidget';
import './globals.css';

// Brand font. next/font downloads it at build time and serves it from our own
// domain (no request to Google from the visitor's browser).
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' });

export const metadata: Metadata = {
  title: 'MerchOS | Multi-tenant Marketplace Product Management',
  description:
    'MerchOS helps South African sellers list, enrich, and publish products to Takealot, Amazon, Shopify, and more from one dashboard.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={dmSans.variable}>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="antialiased">
        {/*
          Amazon Cognito advanced-security (Threat Protection) data collection.
          Loaded for future ENFORCED hardening; harmless under AUDIT.
          See: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-viewing-threat-protection-app.html
        */}
        <Script
          src="https://amazon-cognito-assets.eu-west-1.amazoncognito.com/amazon-cognito-advanced-security-data.min.js"
          strategy="beforeInteractive"
        />
        <Providers>
          {children}
          {/* Live chat bubble on every website and dashboard page. */}
          <ChatWidget />
        </Providers>
      </body>
    </html>
  );
}
