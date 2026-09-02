import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PdfRow {
  customer_name: string;
  customer_mobile: string;
  emi_amount: string;
  missed_count: number;
  due_till_today: string;
  start_date: string;
  closing_date: string | null;
  principal: string;
  received: string;
  remaining: string;
  total_penalty: string;
}

const n = (v: string | number | null | undefined) => Math.round(Number(v ?? 0));
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
  const mx = 5; // margin x

  // ── Modern Header ──
  // Dark navy background
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pw, 16, 'F');
  // Gold accent line
  doc.setFillColor(234, 179, 8);
  doc.rect(0, 16, pw, 1.2, 'F');
  // Title text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(234, 179, 8);
  doc.text('JAI SHRI SHYAM FINANCE', pw / 2, 10.5, { align: 'center' });

  // Date line
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', mx, 22);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, mx + 12, 22);

  const headers = [
    'S.No.', 'Name', 'Amount\nGiven', 'Per Day\nEmi', 'Tut', 'Today\nBal.',
    'Mobile No.', 'Days\nComp.', 'Days\nRem.', 'Start\nDate', 'Closing\nDate',
    'Loan\nAmt', 'Received', 'Balance', 'Penalty\nAdded',
  ];

  const body = rows.map((r, i) => [
    i + 1,
    r.customer_name,
    '',               // Amount Given - empty box
    n(r.emi_amount),
    r.missed_count || '',
    n(r.due_till_today),
    r.customer_mobile,
    daysComp(r),
    daysRem(r),
    d(r.start_date),
    d(r.closing_date),
    n(r.principal),
    n(r.received),    // shows 0 when 0
    n(r.remaining),
    n(r.total_penalty) || '',
  ]);

  autoTable(doc, {
    startY: 24,
    head: [headers],
    body,
    styles: {
      fontSize: 5,
      cellPadding: 0.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [220, 38, 38],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 5,
      cellPadding: 0.7,
    },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0:  { halign: 'center' },
      2:  { halign: 'right' },
      3:  { halign: 'right' },
      4:  { halign: 'right' },
      5:  { halign: 'right' },
      7:  { halign: 'center' },
      8:  { halign: 'center' },
      9:  { halign: 'center' },
      10: { halign: 'center' },
      11: { halign: 'right' },
      12: { halign: 'right' },
      13: { halign: 'right' },
      14: { halign: 'right' },
    },
    theme: 'grid',
    margin: { left: mx, right: mx },
    tableWidth: 'auto',
    didParseCell(data) {
      if (data.section !== 'body') return;
      if (data.column.index === 4 && Number(data.cell.raw) > 0) {
        data.cell.styles.fillColor = [220, 50, 50];
        data.cell.styles.textColor = [255, 255, 255];
      }
      if (data.column.index === 5 && Number(data.cell.raw) > 0) {
        data.cell.styles.fillColor = [22, 163, 74];
        data.cell.styles.textColor = [255, 255, 255];
      }
    },
  });

  doc.save(`${dateStr}.pdf`);
}
