'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { KeyRound, Lock, Plus, UserCheck, UserX } from 'lucide-react';
import { api, apiDelete, apiGet, apiPut } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { dateTime } from '@/lib/format';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { StatusPill } from '@/components/app/status-pill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface User {
  id: string;
  full_name: string;
  mobile: string;
  email: string | null;
  role_name: string;
  is_active: boolean;
  locked_until: string | null;
  created_at: string;
}

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'accounts_dept', label: 'Accounts Dept' },
  { value: 'collection_agent', label: 'Collection Agent' },
];

export default function UsersPage() {
  const qc = useQueryClient();
  const { can, user } = useAuth();
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data = [] } = useQuery({ queryKey: ['users'], queryFn: () => apiGet<User[]>('/users') });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const onErr = (fallback: string) => (err: unknown) => {
    const ax = err as AxiosError<{ error?: { message?: string } }>;
    setError(ax.response?.data?.error?.message ?? fallback);
  };

  const create = useMutation({
    mutationFn: (form: FormData) => api.post('/users', Object.fromEntries(form)),
    onSuccess: () => {
      setError(null);
      setShow(false);
      invalidate();
    },
    onError: onErr('Unable to create user.'),
  });

  const update = useMutation({
    mutationFn: (form: FormData) => apiPut(`/users/${editing!.id}`, Object.fromEntries(form)),
    onSuccess: () => {
      setError(null);
      setEditing(null);
      invalidate();
    },
    onError: onErr('Unable to update user.'),
  });

  const resetPassword = useMutation({
    mutationFn: () => api.post(`/users/${resetting!.id}/reset-password`, { newPassword }),
    onSuccess: () => {
      setError(null);
      setResetting(null);
      setNewPassword('');
    },
    onError: onErr('Unable to reset password.'),
  });

  const unlock = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/unlock`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: onErr('Unable to unlock user.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: onErr('Unable to deactivate user.'),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/reactivate`),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: onErr('Unable to reactivate user.'),
  });

  return (
    <PageShell
      title="Users"
      description="Admin, manager, accounts department, and collection-agent identities for RBAC-controlled operations."
      action={
        can('user.create') ? (
          <Button onClick={() => setShow((v) => !v)}><Plus className="h-4 w-4" /> New User</Button>
        ) : undefined
      }
    >
      {error && <div className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

      {show && (
        <Card>
          <CardHeader><CardTitle>Create User</CardTitle></CardHeader>
          <CardContent>
            <form
              className="grid gap-3 md:grid-cols-3"
              onSubmit={(e) => { e.preventDefault(); create.mutate(new FormData(e.currentTarget)); }}
            >
              <Input name="fullName" placeholder="Full name" required />
              <Input name="mobile" placeholder="Mobile" required />
              <Input name="email" placeholder="Email (optional)" type="email" />
              <Input name="password" placeholder="Password" type="password" required minLength={8} />
              <select name="roleName" className="h-10 rounded-md border bg-background px-3 text-sm" required defaultValue="">
                <option value="" disabled>Select role</option>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <Button disabled={create.isPending}>Create User</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card>
          <CardHeader><CardTitle>Edit {editing.full_name}</CardTitle></CardHeader>
          <CardContent>
            <form
              key={editing.id}
              className="grid gap-3 md:grid-cols-3"
              onSubmit={(e) => { e.preventDefault(); update.mutate(new FormData(e.currentTarget)); }}
            >
              <Input name="fullName" defaultValue={editing.full_name} placeholder="Full name" required />
              <Input name="mobile" defaultValue={editing.mobile} placeholder="Mobile" required />
              <Input name="email" defaultValue={editing.email ?? ''} placeholder="Email" type="email" />
              <select name="roleName" className="h-10 rounded-md border bg-background px-3 text-sm" defaultValue={editing.role_name}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <div className="flex gap-2">
                <Button disabled={update.isPending}>Save</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {resetting && (
        <Card>
          <CardHeader><CardTitle>Reset Password — {resetting.full_name}</CardTitle></CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-center gap-3"
              onSubmit={(e) => { e.preventDefault(); resetPassword.mutate(); }}
            >
              <Input
                type="password"
                placeholder="New password (min 8 characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full sm:w-64"
              />
              <Button disabled={resetPassword.isPending}>Set New Password</Button>
              <Button type="button" variant="outline" onClick={() => { setResetting(null); setNewPassword(''); }}>Cancel</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={['Name', 'Mobile', 'Email', 'Role', 'Status', 'Created', 'Action']}
        rows={data.map((u) => [
          u.full_name,
          u.mobile,
          u.email ?? '-',
          ROLES.find((r) => r.value === u.role_name)?.label ?? u.role_name,
          <StatusPill key={u.id} value={u.is_active ? 'active' : 'closed'} />,
          dateTime(u.created_at),
          <div key={`${u.id}-actions`} className="flex flex-wrap gap-2">
            {can('user.update') && (
              <Button size="sm" variant="outline" onClick={() => setEditing(u)}>Edit</Button>
            )}
            {can('user.update') && (
              <Button size="sm" variant="outline" onClick={() => { setResetting(u); setNewPassword(''); }}>
                <KeyRound className="h-4 w-4" /> Reset Password
              </Button>
            )}
            {can('user.unlock') && u.locked_until && (
              <Button size="sm" variant="outline" onClick={() => unlock.mutate(u.id)}>
                <Lock className="h-4 w-4" /> Unlock
              </Button>
            )}
            {can('user.delete') && u.is_active && u.id !== user?.id && (
              <Button
                size="sm"
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Deactivate ${u.full_name}? They will no longer be able to log in.`)) remove.mutate(u.id);
                }}
              >
                <UserX className="h-4 w-4" /> Deactivate
              </Button>
            )}
            {can('user.delete') && !u.is_active && (
              <Button
                size="sm"
                variant="outline"
                disabled={reactivate.isPending}
                onClick={() => {
                  if (confirm(`Reactivate ${u.full_name}? They will be able to log in again.`)) reactivate.mutate(u.id);
                }}
              >
                <UserCheck className="h-4 w-4" /> Reactivate
              </Button>
            )}
          </div>,
        ])}
      />
    </PageShell>
  );
}
