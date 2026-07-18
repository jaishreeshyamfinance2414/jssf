import { ShieldCheck } from 'lucide-react';
import { PageShell } from '@/components/app/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function RolesPage() {
  return (
    <PageShell title="Roles" description="Permission groups for admin, manager, and collection-agent access.">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> RBAC</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Permissions are seeded in the backend and checked on every protected endpoint. A role-management CRUD screen can now be layered over the roles and role_permissions tables.
        </CardContent>
      </Card>
    </PageShell>
  );
}
