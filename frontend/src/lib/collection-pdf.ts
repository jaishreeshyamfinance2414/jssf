import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PdfRow {
  loan_id: string;
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

/** Pre-fetched collection entry for a specific date (keyed by loan_id). */
export interface DateCollectionEntry {
  loan_id: string;
  amount: string;
  type: string; // full | partial | advance | missed
  mode: string; // cash | upi | bank
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
const daysRem = (r: PdfRow) =>
  r.closing_date ? Math.max(0, Math.ceil((sod(r.closing_date) - now()) / DAY_MS)) : '';

/** Format "Name (Work)" for PDF. */
function formatNameWork(name: string, work: string | null | undefined): string {
  if (!work) return name;
  return `${name} (${work})`;
}

/**
 * Build the "Amount Given" cell value from collected data.
 *  - cash → "amount (C)"
 *  - upi/bank → "amount (B)"
 *  - missed → "Missed"
 *  - no entry → ''
 */
function amountGivenCell(loanId: string, collectionMap: Map<string, DateCollectionEntry>): string {
  const entry = collectionMap.get(loanId);
  if (!entry) return '';
  if (entry.type === 'missed') return 'Missed';
  const amt = n(entry.amount);
  if (entry.mode === 'cash') return `${amt} (C)`;
  return `${amt} (B)`;
}

/** Determine the colour tag for an Amount Given cell. */
function amountGivenTag(loanId: string, collectionMap: Map<string, DateCollectionEntry>): 'cash' | 'bank' | 'missed' | null {
  const entry = collectionMap.get(loanId);
  if (!entry) return null;
  if (entry.type === 'missed') return 'missed';
  return entry.mode === 'cash' ? 'cash' : 'bank';
}

export function downloadCollectionPdf(
  rows: PdfRow[],
  dateStr: string,
  businessName: string,
  areaLabel: string,
  collectedData?: DateCollectionEntry[],
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = 210;
  const mx = 5;
  const tableW = pw - mx * 2; // table width = page minus margins

  // ── Header: Yellow rounded box, black outline, red text ──
  const title = businessName.trim() || 'Jai Shree Shyam Finance';
  doc.setFont('helvetica', 'bold');
  let titleSize = 20;
  doc.setFontSize(titleSize);
  let titleLines = doc.splitTextToSize(title, tableW - 10) as string[];
  while (titleLines.length > 2 && titleSize > 8) {
    titleSize -= 1;
    doc.setFontSize(titleSize);
    titleLines = doc.splitTextToSize(title, tableW - 10) as string[];
  }

  const fontHeight = titleSize * 0.3528;
  const titleLineHeight = fontHeight * 1.05;
  const boxH = Math.max(10, fontHeight + (titleLines.length - 1) * titleLineHeight + 3);
  const boxY = 2;
  doc.setFillColor(255, 255, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.roundedRect(mx, boxY, tableW, boxH, 3, 3, 'FD');

  doc.setFontSize(titleSize);
  doc.setTextColor(255, 0, 0);
  const firstTitleBaseline = boxY + (boxH - (fontHeight + (titleLines.length - 1) * titleLineHeight)) / 2 + fontHeight * 0.8;
  doc.text(titleLines, pw / 2, firstTitleBaseline, {
    align: 'center',
    lineHeightFactor: 1.05,
  });

  // Area + Date line
  const dateLineY = boxY + boxH + 5;
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);

  // Left side: Area label
  doc.setFont('helvetica', 'bold');
  doc.text('Area:', mx, dateLineY);
  doc.setFont('helvetica', 'normal');
  doc.text(areaLabel, mx + 12, dateLineY);

  // Right side: Date
  doc.setFont('helvetica', 'bold');
  const dateLabelX = pw - mx - doc.getTextWidth(dateStr) - doc.getTextWidth('Date: ');
  doc.text('Date:', dateLabelX, dateLineY);
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, dateLabelX + doc.getTextWidth('Date: '), dateLineY);

  // Build collection lookup map
  const collectionMap = new Map<string, DateCollectionEntry>();
  if (collectedData) {
    for (const entry of collectedData) {
      // First entry per loan wins (ordered by entry_date DESC from backend)
      if (!collectionMap.has(entry.loan_id)) {
        collectionMap.set(entry.loan_id, entry);
      }
    }
  }

  // Store per-row colour tags so didParseCell can colour them
  const amountTags: (ReturnType<typeof amountGivenTag>)[] = rows.map((r) =>
    collectedData ? amountGivenTag(r.loan_id, collectionMap) : null,
  );

  // Columns (Spent removed — was "days since start", not useful on paper)
  // Index: 0=S.No  1=Name  2=AmountGiven  3=EMI  4=Tut  5=TodayBal
  //        6=Mobile  7=Left  8=StartDate  9=ClosingDate
  //        10=LoanAmt  11=Received  12=Balance  13=Penalty
  const headers = [
    'S.No.', 'Name', 'Amount\nGiven', 'EMI', 'Tut', 'Today\nBal.',
    'Mobile No.', 'Left', 'Start\nDate', 'Closing\nDate',
    'Loan\nAmt', 'Received', 'Balance', 'Penalty',
  ];

  const body = rows.map((r, i) => [
    i + 1,
    formatNameWork(r.customer_name, r.customer_work),
    collectedData ? amountGivenCell(r.loan_id, collectionMap) : '',
    n(r.emi_amount),
    r.missed_count || '',
    n(r.due_till_today),
    r.customer_mobile,
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
      fontSize: 8,
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
      fontSize: 8.5,
      cellPadding: 1.2,
      overflow: 'visible',
    },
    bodyStyles: {
      minCellHeight: 9,
    },
    alternateRowStyles: { fillColor: false },
    columnStyles: {
      0:  { halign: 'center', cellWidth: 9 },       // S.No.
      1:  { halign: 'left', cellWidth: 32, overflow: 'linebreak' }, // Name (+4)
      2:  { cellWidth: 18, fontStyle: 'bold' },      // Amount Given (+3)
      3:  { cellWidth: 13 },                          // EMI (+auto→13)
      4:  { cellWidth: 10 },                          // Tut (+auto→10)
      5:  { cellWidth: 14 },                          // Today Bal. (+auto→14)
      6:  { cellWidth: 21 },                          // Mobile
      7:  { cellWidth: 10 },                          // Left (was index 8)
      8:  { cellWidth: 15 },                          // Start Date
      9:  { cellWidth: 15 },                          // Closing Date
      10: { cellWidth: 14 },                          // Loan Amt
    },
    theme: 'grid',
    margin: { left: mx, right: mx },
    tableWidth: 'auto',
    didParseCell(data) {
      if (data.section !== 'body') return;

      // Highlight Tut column when missed >= 5
      if (data.column.index === 4 && Number(data.cell.raw) >= 5) {
        data.cell.styles.fillColor = [220, 50, 50];
        data.cell.styles.textColor = [255, 255, 255];
      }

      // Colour the Amount Given column (index 2)
      if (data.column.index === 2) {
        const tag = amountTags[data.row.index];
        if (tag === 'cash') {
          // Green for cash
          data.cell.styles.textColor = [0, 140, 0];
        } else if (tag === 'bank') {
          // Orange-green for bank/UPI
          data.cell.styles.textColor = [200, 120, 0];
        } else if (tag === 'missed') {
          // Red for missed
          data.cell.styles.textColor = [210, 20, 20];
        }
      }
    },
  });

  doc.save(`${dateStr}.pdf`);
}
