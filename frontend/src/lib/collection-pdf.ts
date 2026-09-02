import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PdfRow {
  customer_name: string;
  emi_amount: string;
  missed_count: number;
  due_till_today: string;
  start_date: string;
  closing_date: string | null;
  principal: string;
  received: string;
  remaining: string;
}

const n = (v: string | number | null | undefined) => { const x = Number(v ?? 0); return x ? Math.round(x) : ''; };
const d = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-IN') : '';

const DAY_MS = 86_400_000;
const sod = (v: string) => { const x = new Date(v); x.setHours(0, 0, 0, 0); return x.getTime(); };
const now = () => sod(new Date().toISOString());
const daysComp = (r: PdfRow) => Math.max(0, Math.floor((now() - sod(r.start_date)) / DAY_MS));
const daysRem = (r: PdfRow) =>
  r.closing_date ? Math.max(0, Math.ceil((sod(r.closing_date) - now()) / DAY_MS)) : '';

export function downloadCollectionPdf(rows: PdfRow[], dateStr: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = 210;

  // Yellow header
  doc.setFillColor(255, 255, 0);
  doc.rect(0, 0, pw, 12, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text('JAI SHRI SHYAM FINANCE', pw / 2, 8.5, { align: 'center' });

  // Date
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', 6, 17);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, 18, 17);

  const headers = ['S.No.', 'Name', 'Amount\nGiven', 'Per Day\nEmi', 'Tut', 'Today\nBal.', 'Days\nComp.', 'Days\nRem.', 'Start\nDate', 'Closing\nDate', 'Loan\nAmt', 'Received', 'Balance', 'Penalty\nAdded'];

  const body = rows.map((r, i) => [
    i + 1,
    r.customer_name,
    '',           // Amount Given - empty box
    n(r.emi_amount),
    r.missed_count || '',
    n(r.due_till_today),
    daysComp(r),
    daysRem(r),
    d(r.start_date),
    d(r.closing_date),
    n(r.principal),
    n(r.received),
    n(r.remaining),
    '',           // Penalty Added - empty/no data
  ]);

  autoTable(doc, {
    startY: 19,
    head: [headers],
    body,
    styles: { fontSize: 5, cellPadding: 0.6, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0], overflow: 'linebreak', minCellHeight: 3.5 },
    headStyles: { fillColor: [255, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 5, cellPadding: 0.8, minCellHeight: 6 },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0:  { halign: 'center', cellWidth: 8 },
      1:  { cellWidth: 28 },
      2:  { halign: 'right', cellWidth: 13 },
      3:  { halign: 'right', cellWidth: 13 },
      4:  { halign: 'right', cellWidth: 10 },
      5:  { halign: 'right', cellWidth: 14 },
      6:  { halign: 'center', cellWidth: 11 },
      7:  { halign: 'center', cellWidth: 11 },
      8:  { halign: 'center', cellWidth: 14 },
      9:  { halign: 'center', cellWidth: 14 },
      10: { halign: 'right', cellWidth: 14 },
      11: { halign: 'right', cellWidth: 14 },
      12: { halign: 'right', cellWidth: 14 },
      13: { halign: 'right', cellWidth: 14 },
    },
    theme: 'grid',
    margin: { left: 6, right: 6 },
    didParseCell(data) {
      if (data.section !== 'body') return;
      // Tut (missed) - color red if > 0
      if (data.column.index === 4 && Number(data.cell.raw) > 0) {
        data.cell.styles.fillColor = [220, 50, 50];
        data.cell.styles.textColor = [255, 255, 255];
      }
      // Today Bal - color green if > 0
      if (data.column.index === 5 && Number(data.cell.raw) > 0) {
        data.cell.styles.fillColor = [0, 160, 0];
        data.cell.styles.textColor = [255, 255, 255];
      }
    },
  });

  doc.save(`${dateStr}.pdf`);
}
