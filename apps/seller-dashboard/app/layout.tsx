import type { Metadata } from 'next';
import { SkipNav } from '@merch-os/ui';
import { Providers } from './providers';
import { TopBar } from './components/TopBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'MerchOS - Seller Dashboard',
  description: 'Multi-tenant marketplace product management platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SkipNav contentId="main-content" />
          <TopBar />
          <div className="flex min-h-screen">
            <nav aria-label="Main navigation">
              {/* Sidebar navigation rendered by App Shell */}
            </nav>
            <main id="main-content" className="flex-1">
              {children}
            </main>
            <aside aria-label="Notifications panel">
              {/* Notification panel / supplementary content */}
            </aside>
          </div>
        </Providers>
      </body>
    </html>
  );
}
