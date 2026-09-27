import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { api, apiGet } from './api';
import { loanTypeLabel } from './loan-type';

interface CustomerLoanSummary {
  id: string;
  loan_number: string;
  principal: string;
  status: string;
  emi_frequency: string;
  tenure_count: number;
  loan_date: string;
}

export interface CompleteCustomerData {
  id: string;
  file_number: number;
  full_name: string;
  guardian_name: string | null;
  mobile: string;
  alt_mobile: string | null;
  address: string | null;
  area_name: string | null;
  work: string | null;
  home_type: string | null;
  aadhaar_no: string | null;
  pan_no: string | null;
  guarantor_name: string | null;
  guarantor_mobile: string | null;
  guarantor_aadhaar_no: string | null;
  guarantor_pan_no: string | null;
  latitude: string | null;
  longitude: string | null;
  location_accuracy: string | null;
  location_captured_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
  photo_path: string | null;
  aadhaar_path: string | null;
  pan_path: string | null;
  signature_path: string | null;
  electricity_bill_path: string | null;
  guarantor_photo_path: string | null;
  guarantor_aadhaar_path: string | null;
  guarantor_pan_path: string | null;
  guarantor_signature_path: string | null;
  loans: CustomerLoanSummary[];
}

interface LoanDetail {
  loan: {
    id: string; loan_number: string; principal: string; interest_rate: string; interest_amount: string;
    total_payable: string; status: string; emi_frequency: string; tenure_count: number; emi_amount: string;
    loan_date: string; disbursed_mode: string | null; disbursed_at: string | null; approved_at: string | null;
    rejected_reason: string | null; closed_at: string | null; waiver_amount: string | null;
    received_till_today: string; expected_till_today: string; due_till_today: string;
    advance_balance: string; remaining: string; total_penalty: string;
  };
  collections: Array<{
    id: string; amount: string; penalty: string; type: string; mode: string; collected_at: string;
    entry_date: string; timing: string; agent_name: string | null; note: string | null;
    statement_no: number;
    installment_no: number | null; due_date: string | null; missed_penalty: string | null;
  }>;
}

const DOCUMENTS: Array<[string, keyof CompleteCustomerData]> = [
  ['Customer Photo', 'photo_path'],
  ['Customer Aadhaar', 'aadhaar_path'],
  ['Customer PAN', 'pan_path'],
  ['Customer Signed Cheque', 'signature_path'],
  ['Electricity Bill', 'electricity_bill_path'],
  ['Guarantor Photo', 'guarantor_photo_path'],
  ['Guarantor Aadhaar', 'guarantor_aadhaar_path'],
  ['Guarantor PAN', 'guarantor_pan_path'],
  ['Guarantor Signed Cheque', 'guarantor_signature_path'],
];

const amount = (value: unknown) => `Rs. ${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const displayDate = (value: string | null | undefined, withTime = false) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', withTime
    ? { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }
    : { timeZone: 'Asia/Kolkata', dateStyle: 'medium' });
};
const value = (input: unknown) => input == null || input === '' ? '-' : String(input);

function addHeader(doc: jsPDF, businessName: string, title: string) {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(24, 94, 62);
  doc.rect(0, 0, width, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  let businessNameSize = 15;
  doc.setFontSize(businessNameSize);
  while (doc.getTextWidth(businessName) > width - 24 && businessNameSize > 7) {
    businessNameSize -= 1;
    doc.setFontSize(businessNameSize);
  }
  doc.text(businessName, 12, 10);
  doc.setFontSize(10);
  doc.text(title, 12, 17);
  doc.setTextColor(25, 25, 25);
}

export function buildCustomerDataPages(customer: CompleteCustomerData, loans: LoanDetail[], businessName: string): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  addHeader(doc, businessName, 'Customer Complete Data');

  const closed = loans.filter((item) => item.loan.status === 'closed').length;
  const active = loans.filter((item) => item.loan.status === 'active').length;
  const totalPrincipal = loans.reduce((sum, item) => sum + Number(item.loan.principal), 0);
  const totalReceived = loans.reduce((sum, item) => sum + Number(item.loan.received_till_today), 0);
  const totalRemaining = loans.reduce((sum, item) => sum + Number(item.loan.remaining), 0);
  const documents = DOCUMENTS.filter(([, key]) => !!customer[key]);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(customer.full_name, 12, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`File #${customer.file_number}  |  Generated ${displayDate(new Date().toISOString(), true)}`, 12, 40);

  autoTable(doc, {
    startY: 45,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [24, 94, 62], textColor: 255 },
    head: [['Customer Detail', 'Recorded Value', 'Customer Detail', 'Recorded Value']],
    body: [
      ['Full name', customer.full_name, 'File number', customer.file_number],
      ['Mobile', customer.mobile, 'Alternate mobile', value(customer.alt_mobile)],
      ['Father / Guardian', value(customer.guardian_name), 'Area', value(customer.area_name)],
      ['Address', value(customer.address), 'Work', value(customer.work)],
      ['Home type', value(customer.home_type), 'Customer status', customer.is_active ? 'Active' : 'Deactivated'],
      ['Aadhaar', value(customer.aadhaar_no), 'PAN', value(customer.pan_no)],
      ['Latitude', value(customer.latitude), 'Longitude', value(customer.longitude)],
      ['Location accuracy', customer.location_accuracy ? `${customer.location_accuracy} m` : '-', 'Location captured', displayDate(customer.location_captured_at, true)],
      ['Created', displayDate(customer.created_at, true), 'Last updated', displayDate(customer.updated_at, true)],
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 }, 1: { cellWidth: 61 }, 2: { fontStyle: 'bold', cellWidth: 32 }, 3: { cellWidth: 61 } },
    margin: { left: 12, right: 12 },
  });

  let y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [65, 105, 225], textColor: 255 },
    head: [['Guarantor Detail', 'Recorded Value', 'Guarantor Detail', 'Recorded Value']],
    body: [
      ['Name', value(customer.guarantor_name), 'Mobile', value(customer.guarantor_mobile)],
      ['Aadhaar', value(customer.guarantor_aadhaar_no), 'PAN', value(customer.guarantor_pan_no)],
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 }, 1: { cellWidth: 61 }, 2: { fontStyle: 'bold', cellWidth: 32 }, 3: { cellWidth: 61 } },
    margin: { left: 12, right: 12 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [181, 95, 25], textColor: 255 },
    head: [['Loan Summary', 'Value', 'Loan Summary', 'Value']],
    body: [
      ['Total loans taken', loans.length, 'Active loans', active],
      ['Closed loans', closed, 'Other-status loans', loans.length - active - closed],
      ['Total principal', amount(totalPrincipal), 'Total collected', amount(totalReceived)],
      ['Total outstanding', amount(totalRemaining), 'Documents attached', documents.length],
    ],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 }, 1: { cellWidth: 53 }, 2: { fontStyle: 'bold', cellWidth: 40 }, 3: { cellWidth: 53 } },
    margin: { left: 12, right: 12 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 1.6 },
    headStyles: { fillColor: [55, 55, 55], textColor: 255 },
    head: [['Loan No.', 'Status', 'Loan Date', 'Principal', 'Total Payable', 'Collected', 'Remaining']],
    body: loans.map(({ loan }) => [loan.loan_number, loan.status, displayDate(loan.loan_date), amount(loan.principal), amount(loan.total_payable), amount(loan.received_till_today), amount(loan.remaining)]),
    margin: { left: 12, right: 12 },
  });

  for (const detail of loans) {
    const loan = detail.loan;
    doc.addPage();
    addHeader(doc, businessName, `Loan Statement - ${loan.loan_number}`);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`${customer.full_name} - ${loan.loan_number}`, 12, 34);

    autoTable(doc, {
      startY: 39,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.7 },
      headStyles: { fillColor: [24, 94, 62], textColor: 255 },
      head: [['Loan Detail', 'Value', 'Loan Detail', 'Value']],
      body: [
        ['Status', loan.status, 'Loan date', displayDate(loan.loan_date)],
        ['Principal', amount(loan.principal), 'Total payable', amount(loan.total_payable)],
        ['Interest amount', amount(loan.interest_amount), 'Interest rate', `${Number(loan.interest_rate || 0)}%`],
        ['Installment', amount(loan.emi_amount), 'Frequency / tenure', `${loanTypeLabel(loan.emi_frequency)} x ${loan.tenure_count}`],
        ['Collected', amount(loan.received_till_today), 'Remaining', amount(loan.remaining)],
        ['Expected till today', amount(loan.expected_till_today), 'Due till today', amount(loan.due_till_today)],
        ['Advance balance', amount(loan.advance_balance), 'Penalty added', amount(loan.total_penalty)],
        ['Disbursement', loan.disbursed_mode ? `${loan.disbursed_mode.replaceAll('_', ' ')} - ${displayDate(loan.disbursed_at, true)}` : '-', 'Closed', displayDate(loan.closed_at, true)],
        ['Waiver', amount(loan.waiver_amount), 'Rejection reason', value(loan.rejected_reason)],
      ],
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 1: { cellWidth: 55 }, 2: { fontStyle: 'bold', cellWidth: 38 }, 3: { cellWidth: 55 } },
      margin: { left: 12, right: 12 },
    });

    const statementY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    const entries = [...detail.collections].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.collected_at.localeCompare(b.collected_at));
    autoTable(doc, {
      startY: statementY,
      theme: 'grid',
      styles: { fontSize: 6.7, cellPadding: 1.25, valign: 'middle' },
      headStyles: { fillColor: [55, 55, 55], textColor: 255 },
      head: [['Collected On', 'EMI', 'Due Date', 'Amount', 'Penalty', 'Type', 'Mode', 'Timing', 'Agent']],
      body: entries.map((entry) => [
        displayDate(entry.collected_at, true), entry.statement_no, displayDate(entry.due_date),
        amount(entry.amount), amount(Number(entry.penalty) + Number(entry.missed_penalty ?? 0)),
        entry.type, Number(entry.amount) + Number(entry.penalty) === 0 ? '-' : entry.mode.replaceAll('_', ' '),
        entry.timing.replaceAll('_', ' '), value(entry.agent_name),
      ]),
      margin: { left: 7, right: 7, top: 10, bottom: 12 },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text(`${loan.loan_number} - statement continued`, 7, 7);
        }
      },
    });
    if (!entries.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.text('No collection entries recorded for this loan.', 12, statementY + 8);
    }
  }
  return doc;
}

async function imageAsPng(bytes: ArrayBuffer, contentType: string): Promise<ArrayBuffer> {
  if (contentType.includes('png')) return bytes;
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return bytes;
  const blob = new Blob([bytes], { type: contentType });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare document image');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Unable to convert document image')), 'image/png'));
  return png.arrayBuffer();
}

async function appendDocuments(pdf: PDFDocument, customer: CompleteCustomerData, boldFont: Awaited<ReturnType<PDFDocument['embedFont']>>) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  for (const [label, key] of DOCUMENTS) {
    const path = customer[key];
    if (typeof path !== 'string' || !path) continue;
    const clean = path.replaceAll('\\', '/');
    let response;
    try {
      response = await api.get<ArrayBuffer>(`/files/${clean}`, { responseType: 'arraybuffer' });
    } catch {
      throw new Error(`Unable to download ${label}`);
    }
    const extensionType = path.toLowerCase().endsWith('.pdf') ? 'application/pdf'
      : /\.jpe?g$/i.test(path) ? 'image/jpeg'
        : path.toLowerCase().endsWith('.png') ? 'image/png'
          : path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
    const contentType = String(response.headers['content-type'] ?? extensionType).toLowerCase();
    const isPdf = contentType.includes('pdf') || path.toLowerCase().endsWith('.pdf');
    try {
      if (isPdf) {
        const embeddedPages = await pdf.embedPdf(response.data);
        embeddedPages.forEach((embedded, index) => {
          const page = pdf.addPage([pageWidth, pageHeight]);
          page.drawText(`${label}${embeddedPages.length > 1 ? ` (${index + 1}/${embeddedPages.length})` : ''}`, { x: 28, y: pageHeight - 30, size: 12, font: boldFont, color: rgb(0.09, 0.37, 0.24) });
          const scale = Math.min((pageWidth - 56) / embedded.width, (pageHeight - 90) / embedded.height);
          const width = embedded.width * scale;
          const height = embedded.height * scale;
          page.drawPage(embedded, { x: (pageWidth - width) / 2, y: (pageHeight - 55 - height) / 2, width, height });
        });
      } else {
        const prepared = await imageAsPng(response.data, contentType || 'image/jpeg');
        const isJpeg = contentType.includes('jpeg') || contentType.includes('jpg');
        const image = isJpeg ? await pdf.embedJpg(prepared) : await pdf.embedPng(prepared);
        const page = pdf.addPage([pageWidth, pageHeight]);
        page.drawText(label, { x: 28, y: pageHeight - 30, size: 12, font: boldFont, color: rgb(0.09, 0.37, 0.24) });
        const scale = Math.min((pageWidth - 56) / image.width, (pageHeight - 90) / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - 55 - height) / 2, width, height });
      }
    } catch (error) {
      throw new Error(`Unable to include ${label}: ${error instanceof Error ? error.message : 'unsupported document'}`);
    }
  }
}

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function downloadCompleteCustomerPdf(customer: CompleteCustomerData): Promise<void> {
  let loanDetails: LoanDetail[];
  let businessName: string;
  try {
    const [branding, ...loans] = await Promise.all([
      apiGet<{ businessName: string }>('/settings/branding'),
      ...customer.loans.map((loan) => apiGet<LoanDetail>(`/loans/${loan.id}`)),
    ]);
    businessName = branding.businessName;
    loanDetails = loans;
  } catch (error) {
    throw new Error(
      `Failed to fetch data for PDF: ${error instanceof Error ? error.message : 'server did not respond. Please check your connection and try again.'}`,
    );
  }

  const orderedLoans = loanDetails.sort((a, b) => {
    const rank = (status: string) => status === 'active' ? 0 : status === 'closed' ? 2 : 1;
    return rank(a.loan.status) - rank(b.loan.status) || b.loan.loan_date.localeCompare(a.loan.loan_date);
  });

  let generated: jsPDF;
  try {
    generated = buildCustomerDataPages(customer, orderedLoans, businessName);
  } catch (error) {
    throw new Error(
      `Failed to build PDF pages: ${error instanceof Error ? error.message : 'unexpected error while generating report.'}`,
    );
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(generated.output('arraybuffer'));
  } catch (error) {
    throw new Error(
      `Failed to initialise PDF document: ${error instanceof Error ? error.message : 'the generated report could not be processed.'}`,
    );
  }

  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);

  try {
    await appendDocuments(pdf, customer, boldFont);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'Failed to attach customer documents to the PDF.',
    );
  }

  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const pageWidth = page.getWidth();
    page.drawText(`${businessName}  |  ${customer.full_name}  |  Page ${index + 1} of ${pages.length}`, {
      x: 24, y: 12, size: 7, font: regularFont, color: rgb(0.35, 0.35, 0.35),
      maxWidth: pageWidth - 48,
    });
  });

  let bytes: Uint8Array;
  try {
    bytes = await pdf.save();
  } catch (error) {
    throw new Error(
      `Failed to save PDF: ${error instanceof Error ? error.message : 'the document could not be finalised.'}`,
    );
  }

  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const parts = [customer.full_name, customer.mobile, customer.alt_mobile].filter(Boolean).map((part) => safeFilePart(String(part)));
  link.href = url;
  link.download = `${parts.join(' ')}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadLoanStatementPdf(loanId: string, customerName: string): Promise<void> {
  let detail: LoanDetail;
  let businessName: string;
  try {
    const [branding, loanDetail] = await Promise.all([
      apiGet<{ businessName: string }>('/settings/branding'),
      apiGet<LoanDetail>(`/loans/${loanId}`),
    ]);
    businessName = branding.businessName;
    detail = loanDetail;
  } catch (error) {
    throw new Error(
      `Failed to fetch loan data: ${error instanceof Error ? error.message : 'server did not respond. Please check your connection and try again.'}`,
    );
  }

  const loan = detail.loan;
  let doc: jsPDF;
  try {
    doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    addHeader(doc, businessName, `Loan Statement - ${loan.loan_number}`);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`${customerName} - ${loan.loan_number}`, 12, 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Generated ${displayDate(new Date().toISOString(), true)}`, 12, 40);

    autoTable(doc, {
      startY: 45,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.7 },
      headStyles: { fillColor: [24, 94, 62], textColor: 255 },
      head: [['Loan Detail', 'Value', 'Loan Detail', 'Value']],
      body: [
        ['Status', loan.status, 'Loan date', displayDate(loan.loan_date)],
        ['Principal', amount(loan.principal), 'Total payable', amount(loan.total_payable)],
        ['Interest amount', amount(loan.interest_amount), 'Interest rate', `${Number(loan.interest_rate || 0)}%`],
        ['Installment', amount(loan.emi_amount), 'Frequency / tenure', `${loanTypeLabel(loan.emi_frequency)} x ${loan.tenure_count}`],
        ['Collected', amount(loan.received_till_today), 'Remaining', amount(loan.remaining)],
        ['Expected till today', amount(loan.expected_till_today), 'Due till today', amount(loan.due_till_today)],
        ['Advance balance', amount(loan.advance_balance), 'Penalty added', amount(loan.total_penalty)],
        ['Disbursement', loan.disbursed_mode ? `${loan.disbursed_mode.replaceAll('_', ' ')} - ${displayDate(loan.disbursed_at, true)}` : '-', 'Closed', displayDate(loan.closed_at, true)],
        ['Waiver', amount(loan.waiver_amount), 'Rejection reason', value(loan.rejected_reason)],
      ],
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 1: { cellWidth: 55 }, 2: { fontStyle: 'bold', cellWidth: 38 }, 3: { cellWidth: 55 } },
      margin: { left: 12, right: 12 },
    });

    const statementY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    const entries = [...detail.collections].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.collected_at.localeCompare(b.collected_at));
    autoTable(doc, {
      startY: statementY,
      theme: 'grid',
      styles: { fontSize: 6.7, cellPadding: 1.25, valign: 'middle' },
      headStyles: { fillColor: [55, 55, 55], textColor: 255 },
      head: [['Collected On', 'EMI', 'Due Date', 'Amount', 'Penalty', 'Type', 'Mode', 'Timing', 'Agent']],
      body: entries.map((entry) => [
        displayDate(entry.collected_at, true), entry.statement_no, displayDate(entry.due_date),
        amount(entry.amount), amount(Number(entry.penalty) + Number(entry.missed_penalty ?? 0)),
        entry.type, Number(entry.amount) + Number(entry.penalty) === 0 ? '-' : entry.mode.replaceAll('_', ' '),
        entry.timing.replaceAll('_', ' '), value(entry.agent_name),
      ]),
      margin: { left: 7, right: 7, top: 10, bottom: 12 },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text(`${loan.loan_number} - statement continued`, 7, 7);
        }
      },
    });
    if (!entries.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.text('No collection entries recorded for this loan.', 12, statementY + 8);
    }
  } catch (error) {
    throw new Error(
      `Failed to build statement PDF: ${error instanceof Error ? error.message : 'unexpected error while generating statement.'}`,
    );
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(doc.output('arraybuffer'));
  } catch (error) {
    throw new Error(
      `Failed to initialise PDF document: ${error instanceof Error ? error.message : 'the generated statement could not be processed.'}`,
    );
  }

  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const pageWidth = page.getWidth();
    page.drawText(`${businessName}  |  ${customerName}  |  ${loan.loan_number}  |  Page ${index + 1} of ${pages.length}`, {
      x: 24, y: 12, size: 7, font: regularFont, color: rgb(0.35, 0.35, 0.35),
      maxWidth: pageWidth - 48,
    });
  });

  let bytes: Uint8Array;
  try {
    bytes = await pdf.save();
  } catch (error) {
    throw new Error(
      `Failed to save PDF: ${error instanceof Error ? error.message : 'the statement could not be finalised.'}`,
    );
  }

  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFilePart(customerName)} ${safeFilePart(loan.loan_number)} Statement.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
