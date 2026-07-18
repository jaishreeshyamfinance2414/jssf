/**
 * Tiny duration parser: "15m", "7d", "30d", "12h", "3600s", or a raw ms number.
 * Avoids pulling in the `ms` package for a handful of TTL strings.
 */
export default function ms(input: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(input.trim());
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const value = Number(match[1]);
  const unit = match[2] ?? 'ms';
  const factor: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * factor[unit];
}
