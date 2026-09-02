import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PdfRow {
  loan_number: string;
  customer_name: string;
  emi_amount: string;
  due_till_today: string;
  today_amount: string | null;
  customer_mobile: string;
  start_date: string;
  closing_date: string | null;
  principal: string;
  received: string;
  remaining: string;
}

const fmt = (v: string | number | null | undefined) => Math.round(Number(v ?? 0));
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-IN') : '';

const DAY_MS = 86_400_000;
const startOfDay = (v: string) => { const d = new Date(v); d.setHours(0, 0, 0, 0); return d.getTime(); };
const balDays = (r: PdfRow) =>
  r.closing_date ? Math.max(0, Math.ceil((startOfDay(r.closing_date) - startOfDay(new Date().toISOString())) / DAY_MS)) : '';

export function downloadCollectionPdf(rows: PdfRow[], dateStr: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Yellow header band
  doc.setFillColor(255, 255, 0);
  doc.rect(0, 0, 297, 18, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text('JAI SHRI SHYAM FINANCE', 148.5, 12, { align: 'center' });

  // Date line
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date          ${dateStr}`, 10, 24);

  // Table data
  const body = rows.map((r, i) => [
    i + 1,
    r.loan_number,
    r.customer_name,
    fmt(r.emi_amount),
    fmt(r.due_till_today),
    fmt(r.today_amount),
    r.customer_mobile,
    balDays(r),
    fmtDate(r.start_date),
    fmtDate(r.closing_date),
    fmt(r.principal),
    fmt(r.received),
    fmt(r.remaining),
  ]);

  autoTable(doc, {
    startY: 27,
    head: [['S. No.', 'File No', 'Name', 'Amt Given Emi', 'Tut', 'Today Bal.', 'Mobile No.', 'Bal Days', 'Start Date', 'End Date', 'Loan Amt', 'Received', 'Balance']],
    body,
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [255, 0, 0], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'center', cellWidth: 14 },
      2: { cellWidth: 40 },
      3: { halign: 'right', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 15 },
      5: { halign: 'right', cellWidth: 20 },
      6: { cellWidth: 24 },
      7: { halign: 'center', cellWidth: 16 },
      8: { halign: 'center', cellWidth: 20 },
      9: { halign: 'center', cellWidth: 20 },
      10: { halign: 'right', cellWidth: 18 },
      11: { halign: 'right', cellWidth: 18 },
      12: { halign: 'right', cellWidth: 18 },
    },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    theme: 'grid',
  });

  doc.save(`${dateStr}.pdf`);
}
