export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

export const date = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-IN') : '-';

/** Exact date + time (hh:mm:ss) in Indian Standard Time, for entry-created/event timestamps. */
export const dateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '-';
