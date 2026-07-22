import { Settings } from 'lucide-react';
import { PageShell } from '@/components/app/page-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <PageShell title="Settings" description="Business rules for penalty, interest, and loan number format.">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-4 w-4" /> Business Rules</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <div className="rounded-md border p-3">Penalty: 0.5% per missed day</div>
          <div className="rounded-md border p-3">Default flat interest: 10%</div>
          <div className="rounded-md border p-3">Loan format: JSSF-year-sequence</div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
