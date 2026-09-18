import type { Metadata, Viewport } from 'next';
import { Sora } from 'next/font/google';
import './globals.css';
import { Providers } from '@/lib/providers';
import { PwaInstall } from '@/components/pwa-install';

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

export async function generateMetadata(): Promise<Metadata> {
  let businessName = 'Upcoming';
  let faviconVersion: string | null = null;
  try {
    const response = await fetch(`${process.env.API_PROXY_TARGET ?? 'http://localhost:4000'}/api/v1/settings/branding`,
      { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      const result = await response.json() as { data?: { businessName?: string; faviconVersion?: string | null } };
      businessName = result.data?.businessName || businessName;
      faviconVersion = result.data?.faviconVersion ?? null;
    }
  } catch { /* Use defaults until the backend is available. */ }
  const favicon = `/api/v1/settings/branding/assets/favicon${faviconVersion ? `?v=${encodeURIComponent(faviconVersion)}` : ''}`;
  return {
    title: businessName,
    description: 'Loan Management System',
    manifest: '/api/v1/settings/branding/manifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: businessName },
    icons: { icon: { url: favicon, type: faviconVersion ? 'image/png' : 'image/svg+xml' },
      apple: faviconVersion ? favicon : undefined },
  };
}

export const viewport: Viewport = {
  themeColor: '#12805A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sora.variable}>
      <body>
        <Providers>{children}<PwaInstall /></Providers>
      </body>
    </html>
  );
}
