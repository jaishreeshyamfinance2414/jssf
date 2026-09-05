import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PdfRow {
  customer_name: string;
  customer_work: string | null;
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

/** Format "Name (Work)" for PDF, truncating progressively if > 25 chars. */
function formatNameWork(name: string, work: string | null | undefined): string {
  if (!work) return name;
  const full = `${name} (${work})`;
  if (full.length <= 25) return full;
  // Try: full name + first letter of work
  const shortWork = `${name} (${work[0]})`;
  if (shortWork.length <= 25) return shortWork;
  // Try: first 2 words of name + first letter of work (only if 2+ words)
  const words = name.split(/\s+/);
  if (words.length >= 2) {
    const two = `${words[0]} ${words[1]} (${work[0]})`;
    if (two.length <= 25) return two;
  }
  // Fallback: first word of name + first letter of work
  return `${words[0]} (${work[0]})`;
}

export function downloadCollectionPdf(rows: PdfRow[], dateStr: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = 210;
  const mx = 5;
  const tableW = pw - mx * 2; // table width = page minus margins

  // ── Header: Yellow rounded box, black outline, red text ──
  const boxH = 10;
  const boxY = 2;
  doc.setFillColor(255, 255, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.roundedRect(mx, boxY, tableW, boxH, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20); // ~25pt Word equivalent
  doc.setTextColor(255, 0, 0);
  doc.text('JAI SHRI SHYAM FINANCE', pw / 2, boxY + boxH / 2, { align: 'center', baseline: 'middle' });

  // Date
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', mx, boxY + boxH + 5);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, mx + 14, boxY + boxH + 5);

  const headers = [
    'S.No.', 'Name', 'Amt\nGiven', 'Per Day\nEmi', 'Tut', 'Today\nBal.',
    'Mobile No.', 'Days\nComp.', 'Days\nRem.', 'Start\nDate', 'Closing\nDate',
    'Loan\nAmt', 'Received', 'Balance', 'Penalty',
  ];

  const body = rows.map((r, i) => [
    i + 1,
    formatNameWork(r.customer_name, r.customer_work),
    '',
    n(r.emi_amount),
    r.missed_count || '',
    n(r.due_till_today),
    r.customer_mobile,
    daysComp(r),
    daysRem(r),
    d(r.start_date),
    d(r.closing_date),
    n(r.principal),
    n(r.received),
    n(r.remaining),
    n(r.total_penalty) || '',
  ]);

  autoTable(doc, {
    startY: boxY + boxH + 7,
    head: [headers],
    body,
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [220, 38, 38],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 7,
      cellPadding: 1.2,
    },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0:  { halign: 'center' },
      2:  { halign: 'right' },
      3:  { halign: 'right' },
      4:  { halign: 'right' },
      5:  { halign: 'right' },
      7:  { halign: 'right' },
      8:  { halign: 'right' },
      9:  { halign: 'right' },
      10: { halign: 'right' },
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
      // Highlight Tut column only when missed >= 5
      if (data.column.index === 4 && Number(data.cell.raw) >= 5) {
        data.cell.styles.fillColor = [220, 50, 50];
        data.cell.styles.textColor = [255, 255, 255];
      }
    },
  });

  doc.save(`${dateStr}.pdf`);
}
