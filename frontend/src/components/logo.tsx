'use client';

import { cn } from '@/lib/utils';
import { useBranding } from '@/lib/branding-context';

// Keep uploaded artwork legible on both light and dark surfaces.
export function Logo({ className, size = 40 }: { className?: string; size?: number }) {
  const { businessName, logoUrl } = useBranding();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={businessName} width={size} height={size} className="h-full w-full object-contain" />
      ) : <span className="px-0.5 text-center text-[8px] font-semibold leading-tight text-slate-600">Upcoming</span>}
    </span>
  );
}
