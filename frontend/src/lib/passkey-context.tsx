'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { setPasskeyPrompt } from './api';

/**
 * Admin passkey popup. The axios layer calls promptPasskey() whenever the
 * server answers 428 PASSKEY_REQUIRED; we show a themed 4-digit PIN dialog
 * and resolve with the entered PIN (or null on cancel). The request is then
 * retried with the x-admin-passkey header.
 */
export function PasskeyProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [digits, setDigits] = useState(['', '', '', '']);
  const resolver = useRef<((pin: string | null) => void) | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setPasskeyPrompt(
      (msg) =>
        new Promise<string | null>((resolve) => {
          resolver.current = resolve;
          setMessage(msg ?? null);
          setDigits(['', '', '', '']);
          setOpen(true);
          setTimeout(() => inputs.current[0]?.focus(), 50);
        }),
    );
    return () => setPasskeyPrompt(null);
  }, []);

  const finish = useCallback((pin: string | null) => {
    setOpen(false);
    resolver.current?.(pin);
    resolver.current = null;
  }, []);

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = d;
      return next;
    });
    if (d && i < 3) inputs.current[i + 1]?.focus();
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pin = digits.join('');
    if (pin.length === 4) finish(pin);
  };

  return (
    <>
      {children}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <form
            onSubmit={submit}
            className="w-full max-w-xs rounded-2xl border bg-card p-6 text-card-foreground shadow-2xl"
          >
            <div className="mb-4 flex flex-col items-center gap-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <h2 className="text-lg font-bold">Admin Passkey</h2>
              <p className="text-sm text-muted-foreground">
                {message ?? 'Enter the 4-digit passkey to confirm this action.'}
              </p>
            </div>
            <div className="mb-5 flex justify-center gap-3">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputs.current[i] = el;
                  }}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="h-12 w-12 rounded-lg border bg-background text-center text-xl font-bold text-foreground outline-none ring-primary/40 focus:border-primary focus:ring-2"
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => finish(null)}
                className="flex-1 rounded-lg border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={digits.join('').length !== 4}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
