'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AxiosError } from 'axios';
import { Landmark, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const schema = z.object({
  identifier: z.string().min(3, 'Enter email or mobile number'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { rememberMe: false } });

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [user, loading, router]);

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      await login(values.identifier, values.password, values.rememberMe ?? false);
      router.replace('/dashboard');
    } catch (err) {
      const ax = err as AxiosError<{ error?: { message?: string } }>;
      setServerError(ax.response?.data?.error?.message ?? 'Login failed. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
            <Landmark className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold text-white">Jai Shree Shyam Finance</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight text-white">
            Loan Management,
            <br /> done right.
          </h1>
          <p className="mt-4 max-w-md text-sidebar-foreground">
            Customers, loans, approvals, collections, agents and reports — one secure,
            enterprise-grade platform replacing the old spreadsheets.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/60">
          © {new Date().getFullYear()} Jai Shree Shyam Finance. All rights reserved.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2 text-primary">
              <Landmark className="h-6 w-6" />
              <span className="text-lg font-bold">JSSF</span>
            </div>
          </div>
          <h2 className="text-2xl font-bold">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your email or mobile number.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email or Mobile</label>
              <Input placeholder="admin@jssf.local or 9999999999" {...register('identifier')} />
              {errors.identifier && (
                <p className="mt-1 text-xs text-danger">{errors.identifier.message}</p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Password</label>
              <Input type="password" placeholder="••••••••" {...register('password')} />
              {errors.password && (
                <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="h-4 w-4 rounded border-input" {...register('rememberMe')} />
              Remember me for 30 days
            </label>

            {serverError && (
              <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                {serverError}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
