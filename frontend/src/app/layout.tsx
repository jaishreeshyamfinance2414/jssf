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
  let businessName = 'Jai Shree Shyam Finance';
  let faviconVersion: string | null = null;
  try {
    const response = await fetch(`${process.env.API_PROXY_TARGET ?? 'http://localhost:4000'}/api/v1/settings/branding`,
      { cache: 'no-store' });
    if (response.ok) {
      const result = await response.json() as { data?: { businessName?: string; faviconVersion?: string | null } };
      businessName = result.data?.businessName || businessName;
      faviconVersion = result.data?.faviconVersion ?? null;
    }
  } catch { /* Use defaults until the backend is available. */ }
  const favicon = faviconVersion
    ? `/api/v1/settings/branding/assets/favicon?v=${encodeURIComponent(faviconVersion)}`
    : '/icon.png';
  return {
    title: businessName,
    description: 'Loan Management System',
    manifest: '/api/v1/settings/branding/manifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: businessName },
    icons: { icon: favicon, apple: faviconVersion ? favicon : '/icons/apple-touch-icon.png' },
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
