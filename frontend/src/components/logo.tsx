import { cn } from '@/lib/utils';

// Brand logo mark. The artwork is navy/gold on white, so it sits inside a
// white rounded tile — legible on light and dark surfaces alike. With
// `adaptive`, the tile border follows the surface (subtle on light, none on dark).
export function Logo({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Jai Shri Shyam Finance" width={size} height={size} />
    </span>
  );
}
