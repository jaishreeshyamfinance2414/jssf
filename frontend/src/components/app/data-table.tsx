import { ReactNode } from 'react';

/**
 * Responsive data list. On ≥md it renders a classic table; on small screens the
 * same rows become stacked label/value cards so nothing needs sideways
 * scrolling. `mobilePrimary` marks which columns form the card header line
 * (defaults to the first column).
 */
export function DataTable({
  columns,
  rows,
  empty = 'No records found',
  mobilePrimary = [0],
}: {
  columns: string[];
  rows: ReactNode[][];
  empty?: string;
  /** Column indexes rendered prominently at the top of each mobile card. */
  mobilePrimary?: number[];
}) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }

  return (
    <>
      {/* Mobile: stacked cards */}
      <div className="space-y-3 md:hidden">
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 pb-2.5">
              {mobilePrimary.map((idx) =>
                row[idx] != null ? (
                  <div key={idx} className="text-sm font-semibold text-foreground">
                    {row[idx]}
                  </div>
                ) : null,
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {row.map((cell, j) => {
                if (mobilePrimary.includes(j) || cell == null || cell === '') return null;
                // A trailing Action/Decision/Collect/Statement column holds
                // buttons — give it the full card width. (Only the last column:
                // e.g. approval-requests has a data column also named "Action".)
                const isAction =
                  j === row.length - 1 && /action|decision|collect|statement/i.test(columns[j] ?? '');
                if (isAction) {
                  return (
                    <div key={j} className="col-span-2 mt-1 border-t border-border/60 pt-2.5 [&_a]:min-h-9 [&_button]:min-h-9">
                      {cell}
                    </div>
                  );
                }
                return (
                  <div key={j} className="min-w-0">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {columns[j]}
                    </dt>
                    <dd className="mt-0.5 break-words text-[13px] text-foreground">{cell}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="px-4 py-3 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-3 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
