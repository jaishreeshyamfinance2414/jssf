'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, UserPlus, X } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { PageShell } from '@/components/app/page-shell';
import { DataTable } from '@/components/app/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Area { id: string; name: string; code: string | null; customer_count?: string; agent_count?: string }
interface AreaAgent { agent_id: string; full_name: string; mobile: string; role_name: string }
interface Staff { id: string; full_name: string; role_name: string; is_active: boolean }

export default function AreasPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can('area.manage');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [openArea, setOpenArea] = useState<Area | null>(null);
  const [agentId, setAgentId] = useState('');
  const { data = [] } = useQuery({ queryKey: ['areas'], queryFn: () => apiGet<Area[]>('/areas') });
  const { data: areaAgents = [] } = useQuery({
    queryKey: ['area-agents', openArea?.id],
    queryFn: () => apiGet<AreaAgent[]>(`/areas/${openArea!.id}/agents`),
    enabled: !!openArea,
  });
  const { data: staff = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiGet<Staff[]>('/users'),
    enabled: canManage && can('user.view'),
  });
  const create = useMutation({
    mutationFn: () => apiPost('/areas', { name, code: code || null }),
    onSuccess: () => {
      setName('');
      setCode('');
      qc.invalidateQueries({ queryKey: ['areas'] });
    },
  });
  const assign = useMutation({
    mutationFn: () => apiPost(`/areas/${openArea!.id}/agents`, { agentId }),
    onSuccess: () => {
      setAgentId('');
      qc.invalidateQueries({ queryKey: ['area-agents'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
    },
  });
  const unassign = useMutation({
    mutationFn: (id: string) => apiDelete(`/areas/${openArea!.id}/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['area-agents'] });
      qc.invalidateQueries({ queryKey: ['areas'] });
    },
  });
  // Agents not yet assigned to the open area (collection agents + managers).
  const assignable = staff.filter(
    (u) => u.is_active && !areaAgents.some((a) => a.agent_id === u.id),
  );

  return (
    <PageShell title="Areas" description="Define operating areas for customer assignment and collection routing.">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Create Area</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Area name" required />
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" />
            <Button disabled={create.isPending}><Plus className="h-4 w-4" /> Add</Button>
          </form>
        </CardContent>
      </Card>
      {openArea && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Agents — {openArea.name}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpenArea(null)}>Close</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManage && (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); if (agentId) assign.mutate(); }}
              >
                <select
                  className="h-10 min-w-56 rounded-md border bg-background px-3 text-sm"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  required
                >
                  <option value="">Select agent to assign</option>
                  {assignable.map((u) => <option key={u.id} value={u.id}>{u.full_name} — {u.role_name}</option>)}
                </select>
                <Button disabled={assign.isPending || !agentId}><UserPlus className="h-4 w-4" /> Assign</Button>
              </form>
            )}
            <DataTable
              columns={['Agent', 'Mobile', 'Role', 'Action']}
              rows={areaAgents.map((a) => [
                a.full_name,
                a.mobile,
                a.role_name,
                canManage ? (
                  <Button
                    key={a.agent_id}
                    size="sm"
                    variant="danger"
                    disabled={unassign.isPending}
                    onClick={() => {
                      if (confirm(`Remove ${a.full_name} from ${openArea.name}? They will no longer be able to collect in this area.`)) {
                        unassign.mutate(a.agent_id);
                      }
                    }}
                  >
                    <X className="h-4 w-4" /> Remove
                  </Button>
                ) : '-',
              ])}
              empty="No agents assigned — any collection agent can currently collect in this area"
            />
          </CardContent>
        </Card>
      )}
      <DataTable
        columns={['Area', 'Code', 'Customers', 'Agents', 'Action']}
        rows={data.map((a) => [
          a.name,
          a.code ?? '-',
          a.customer_count ?? '0',
          a.agent_count ?? '0',
          <Button key={a.id} size="sm" variant="outline" onClick={() => { setOpenArea(a); setAgentId(''); }}>
            <UserPlus className="h-4 w-4" /> Manage Agents
          </Button>,
        ])}
      />
    </PageShell>
  );
}
