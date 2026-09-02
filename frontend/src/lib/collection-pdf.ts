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

function drawHeader(doc: jsPDF, pw: number) {
  // ── Dark green banner ──
  doc.setFillColor(21, 101, 52);           // dark green
  doc.rect(0, 0, pw, 24, 'F');

  // ── Bottom wave (dark green flowing into white) ──
  doc.setFillColor(21, 101, 52);
  doc.lines(
    [[pw * 0.35, 8, pw * 0.65, -4, pw, 2], [0, 6], [-pw, 0]],
    0, 22, [1, 1], 'F', true,
  );

  // ── Light green accent wave ──
  doc.setFillColor(34, 197, 94);
  doc.lines(
    [[pw * 0.3, 6, pw * 0.7, -3, pw, 1.5], [0, 2], [-pw, 0]],
    0, 23, [1, 1], 'F', true,
  );

  // ── Thin bright green edge ──
  doc.setFillColor(74, 222, 128);
  doc.lines(
    [[pw * 0.25, 5, pw * 0.75, -2, pw, 1], [0, 1], [-pw, 0]],
    0, 25, [1, 1], 'F', true,
  );

  // ── Title text ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('JAI SHRI SHYAM FINANCE', pw / 2, 15, { align: 'center' });
}

export function downloadCollectionPdf(rows: PdfRow[], dateStr: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = 210;
  const mx = 5;

  drawHeader(doc, pw);

  // Date
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.text('Date', mx, 36);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, mx + 14, 36);

  const headers = [
    'S.No.', 'Name', 'Amt\nGiven', 'Per Day\nEmi', 'Tut', 'Today\nBal.',
    'Mobile No.', 'Days\nComp.', 'Days\nRem.', 'Start\nDate', 'Closing\nDate',
    'Loan\nAmt', 'Received', 'Balance', 'Penalty',
  ];

  const body = rows.map((r, i) => [
    i + 1,
    r.customer_name,
    '',               // Amount Given - empty
    n(r.emi_amount),
    r.missed_count || '',
    n(r.due_till_today),
    r.customer_mobile,
    daysComp(r),
    daysRem(r),
    d(r.start_date),
    d(r.closing_date),
    n(r.principal),
    n(r.received),    // shows 0
    n(r.remaining),
    n(r.total_penalty) || '',
  ]);

  const fs = 8; // ~12pt Word Calibri prints similarly to 8pt PDF helvetica (PDF points are larger)

  autoTable(doc, {
    startY: 39,
    head: [headers],
    body,
    styles: {
      font: 'helvetica',
      fontSize: fs,
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
    didDrawPage(data) {
      // Redraw header on every page
      if (data.pageNumber > 1) {
        drawHeader(doc, pw);
      }
    },
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
