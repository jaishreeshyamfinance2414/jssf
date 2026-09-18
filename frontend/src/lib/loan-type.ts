export function loanTypeLabel(frequency: string): string {
  if (frequency === 'daily') return 'Daily EMI';
  if (frequency === 'meter') return 'Meter Loan';
  // Existing contracts retain their original schedule and frequency.
  return `${frequency.charAt(0).toUpperCase()}${frequency.slice(1)} EMI`;
}
