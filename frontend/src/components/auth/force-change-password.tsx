'use client';

import { FormEvent, useState } from 'react';
import { AxiosError } from 'axios';
import { KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * Full-screen blocking form shown when the account has must_change_password
 * set (seeded accounts, admin resets). The backend rejects every business
 * endpoint until the password is replaced, so there is no way around it.
 */
export function ForceChangePassword() {
  const { changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (err) {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setError(ax.response?.data?.error?.message ?? 'Password change failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Set a new password
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            For security you must replace your temporary password before using the app.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input
              type="password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              autoFocus
            />
            <Input
              type="password"
              placeholder="New password (min 8 chars, letter + number)"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => logout()}>
                Log out
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
