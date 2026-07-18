import { ReactNode } from 'react';

/**
 * Shared page wrapper. The visible page title lives in the Topbar (derived from
 * the route), so here the title is screen-reader-only — rendering it again as a
 * heading would duplicate it on every page.
 */
export function PageShell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="sr-only">{title}</h1>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-[13px] leading-snug text-muted-foreground sm:text-sm">
          {description}
        </p>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
