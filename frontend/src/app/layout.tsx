import type { Metadata } from 'next';
import { Sora } from 'next/font/google';
import './globals.css';
import { Providers } from '@/lib/providers';

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'Jai Shree Shyam Finance',
  description: 'Loan Management System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sora.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
