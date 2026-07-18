import { cn } from '@/lib/utils';

const tone: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-primary/15 text-primary',
  active: 'bg-success/15 text-success',
  paid: 'bg-success/15 text-success',
  full: 'bg-success/15 text-success',
  advance: 'bg-primary/15 text-primary',
  closed: 'bg-muted text-muted-foreground',
  rejected: 'bg-danger/15 text-danger',
  missed: 'bg-danger/15 text-danger',
  partial: 'bg-warning/15 text-warning',
};

export function StatusPill({ value }: { value: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-semibold', tone[value.toLowerCase()] ?? 'bg-muted')}>
      {value.replaceAll('_', ' ')}
    </span>
  );
}
