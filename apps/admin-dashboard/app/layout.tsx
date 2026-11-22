import type { Metadata } from 'next';
import Script from 'next/script';
import { DM_Sans } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

// Brand font, self-hosted by next/font (same as the seller app).
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' });

export const metadata: Metadata = {
  title: 'MerchOS - Admin Dashboard',
  description: 'Platform administration and monitoring dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="antialiased">
        {/*
          Amazon Cognito advanced-security (Threat Protection) data collection.
          Amplify JS does NOT collect device-fingerprint UserContextData on its
          own (unlike the mobile SDKs); it attaches the context ONLY if this
          script has defined the global AmazonCognitoAdvancedSecurityData. With
          it loaded, signIn/confirmSignIn send EncodedData so a pool set to
          Threat Protection = ENFORCED can risk-score the request instead of
          blocking it. Region must match the user pool (eu-west-1).
          beforeInteractive => available before Amplify auth runs.
          See: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-viewing-threat-protection-app.html
        */}
        <Script
          src="https://amazon-cognito-assets.eu-west-1.amazoncognito.com/amazon-cognito-advanced-security-data.min.js"
          strategy="beforeInteractive"
        />
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
