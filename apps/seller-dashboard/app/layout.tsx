import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'MerchOS — Multi-tenant Marketplace Product Management',
  description:
    'MerchOS helps South African sellers list, enrich, and publish products to Takealot, Amazon, Shopify, and more from one dashboard.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
