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
const d = (v: string | null | undefined) => {
  if (!v) return '';
  const dt = new Date(v);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = String(dt.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
};

const DAY_MS = 86_400_000;
const sod = (v: string) => { const x = new Date(v); x.setHours(0, 0, 0, 0); return x.getTime(); };
const now = () => sod(new Date().toISOString());
const daysComp = (r: PdfRow) => Math.max(0, Math.floor((now() - sod(r.start_date)) / DAY_MS));
const daysRem = (r: PdfRow) =>
  r.closing_date ? Math.max(0, Math.ceil((sod(r.closing_date) - now()) / DAY_MS)) : '';

/** Format "Name (Work)" for PDF. */
function formatNameWork(name: string, work: string | null | undefined): string {
  if (!work) return name;
  return `${name} (${work})`;
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
    'S.No.', 'Name', 'Amount\nGiven', 'EMI', 'Tut', 'Today\nBal.',
    'Mobile No.', 'Spent', 'Left', 'Start\nDate', 'Closing\nDate',
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
      cellPadding: { top: 1.5, bottom: 1.5, left: 1, right: 1 },
      lineColor: [0, 0, 0],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      overflow: 'visible',
      halign: 'right',
      valign: 'middle',
      minCellHeight: 9,
    },
    headStyles: {
      fillColor: [34, 139, 34],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 9,
      cellPadding: 1.2,
      overflow: 'visible',
    },
    bodyStyles: {
      minCellHeight: 9,
    },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0:  { halign: 'center', cellWidth: 9 },
      1:  { halign: 'left', cellWidth: 28, overflow: 'linebreak' },
      2:  { cellWidth: 15 },
      6:  { cellWidth: 21 },
      7:  { cellWidth: 10 },
      8:  { cellWidth: 10 },
      9:  { cellWidth: 15 },
      10: { cellWidth: 15 },
      11: { cellWidth: 14 },
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
