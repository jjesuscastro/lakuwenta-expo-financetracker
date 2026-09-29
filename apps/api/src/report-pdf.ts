import PDFDocument from 'pdfkit';
import type { Comparison } from './reports.js';

export type MonthlyPdfReport = {
  month: string;
  expenses: string;
  debtPayments: string;
  totalOutflow: string;
  debtCollections: string;
  categories: Comparison[];
  transactions?: Array<{
    name: string;
    amount: string;
    date: string;
    type: string;
    categoryName: string | null;
    goalName: string | null;
    debtName: string | null;
  }>;
};

const colors = {
  green: '#176B52',
  dark: '#19382D',
  text: '#344A40',
  muted: '#7C8B83',
  line: '#E4EBE6',
  pale: '#F3F7F4',
  white: '#FFFFFF',
  orange: '#A85D3F',
  blue: '#47745E',
};

function formatMonth(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, number - 1, 1)));
}

function peso(value: string): string {
  return `PHP ${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function comparisonLabel(item: Comparison): { text: string; color: string } {
  if (item.isNew) return { text: 'NEW', color: colors.blue };
  if (item.changePercent === null) return { text: 'NO PRIOR SPENDING', color: colors.muted };
  if (item.changePercent > 0) return { text: `+${item.changePercent}%`, color: colors.orange };
  if (item.changePercent < 0) return { text: `${item.changePercent}%`, color: colors.green };
  return { text: '0%', color: colors.muted };
}

function statementType(transaction: NonNullable<MonthlyPdfReport['transactions']>[number]): string {
  if (transaction.type === 'EXPENSE') return transaction.categoryName ?? 'Expense';
  if (transaction.type === 'GOAL_CONTRIBUTION') return transaction.goalName ? `Savings · ${transaction.goalName}` : 'Savings contribution';
  if (transaction.type === 'DEBT_PAYMENT') return transaction.debtName ? `Debt payment · ${transaction.debtName}` : 'Debt repayment';
  if (transaction.type === 'DEBT_COLLECTION') return transaction.debtName ? `Debt collection · ${transaction.debtName}` : 'Debt collection';
  return transaction.type;
}

export function renderMonthlyReportPdf(report: MonthlyPdfReport): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 44, size: 'A4', bufferPages: true });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = 44;
  const width = 507;
  const cardGap = 10;
  const cardWidth = (width - cardGap * 3) / 4;

  // Cover banner
  doc.roundedRect(left, 44, width, 126, 14).fill(colors.green);
  doc.fillColor('#BBD9C8').font('Helvetica-Bold').fontSize(9).text('LAKUWENTA  /  MONTHLY SUMMARY', left + 22, 64, { characterSpacing: 1.1 });
  doc.fillColor(colors.white).font('Helvetica-Bold').fontSize(25).text(formatMonth(report.month), left + 22, 88);
  doc.fillColor('#E1EEE6').font('Helvetica').fontSize(10).text('Personal finance report  •  Amounts in Philippine pesos', left + 22, 128);

  // Summary cards
  const cards = [
    { label: 'EXPENSES', amount: report.expenses },
    { label: 'DEBT PAID', amount: report.debtPayments },
    { label: 'TOTAL OUTFLOW', amount: report.totalOutflow, featured: true },
    { label: 'DEBT COLLECTED', amount: report.debtCollections },
  ];
  const cardsY = 190;
  cards.forEach((card, index) => {
    const x = left + index * (cardWidth + cardGap);
    doc.roundedRect(x, cardsY, cardWidth, 78, 10).fill(card.featured ? '#E8F2EC' : colors.pale);
    doc.fillColor(card.featured ? colors.green : colors.muted).font('Helvetica-Bold').fontSize(7.5)
      .text(card.label, x + 10, cardsY + 14, { width: cardWidth - 20, characterSpacing: 0.4 });
    doc.fillColor(colors.dark).font('Helvetica-Bold').fontSize(11.5)
      .text(peso(card.amount), x + 10, cardsY + 37, { width: cardWidth - 20, lineBreak: false, ellipsis: true });
  });

  // Category comparison table
  const tableY = 300;
  doc.fillColor(colors.dark).font('Helvetica-Bold').fontSize(15).text('Category comparison', left, tableY);
  doc.fillColor(colors.muted).font('Helvetica').fontSize(9).text('Spending compared with the previous calendar month', left, tableY + 23);
  const headerY = tableY + 49;
  doc.roundedRect(left, headerY, width, 27, 6).fill(colors.pale);
  doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(7.5);
  doc.text('CATEGORY', left + 12, headerY + 9, { characterSpacing: 0.5 });
  doc.text('THIS MONTH', left + 195, headerY + 9, { width: 87, align: 'right', characterSpacing: 0.3 });
  doc.text('LAST MONTH', left + 292, headerY + 9, { width: 87, align: 'right', characterSpacing: 0.3 });
  doc.text('CHANGE', left + 390, headerY + 9, { width: 105, align: 'right', characterSpacing: 0.5 });

  let rowY = headerY + 27;
  for (const [index, item] of report.categories.entries()) {
    if (rowY > doc.page.height - 78) {
      doc.addPage();
      rowY = 55;
      doc.fillColor(colors.dark).font('Helvetica-Bold').fontSize(15).text('Category comparison (continued)', left, rowY);
      rowY += 28;
    }
    const rowHeight = 43;
    if (index % 2 === 1) doc.rect(left, rowY, width, rowHeight).fill('#FBFCFB');
    doc.fillColor(colors.line).rect(left, rowY + rowHeight - 0.6, width, 0.6).fill();
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(9.5).text(item.name, left + 12, rowY + 15, { width: 170, ellipsis: true });
    doc.fillColor(colors.dark).font('Helvetica').fontSize(9).text(peso(item.amount), left + 195, rowY + 15, { width: 87, align: 'right' });
    doc.fillColor(colors.muted).font('Helvetica').fontSize(9).text(peso(item.previousAmount), left + 292, rowY + 15, { width: 87, align: 'right' });
    const change = comparisonLabel(item);
    doc.fillColor(change.color).font('Helvetica-Bold').fontSize(change.text.length > 8 ? 7 : 9)
      .text(change.text, left + 390, rowY + 15, { width: 105, align: 'right' });
    rowY += rowHeight;
  }

  if (!report.categories.length) {
    doc.fillColor(colors.muted).font('Helvetica').fontSize(10).text('No expense categories recorded for this month.', left + 12, rowY + 16);
    rowY += 43;
  }

  const footerY = Math.min(Math.max(rowY + 22, 730), doc.page.height - 57);
  doc.fillColor(colors.line).rect(left, footerY, width, 0.8).fill();
  doc.fillColor(colors.muted).font('Helvetica').fontSize(8)
    .text('LaKuwenta  •  Generated from your recorded transactions', left, footerY + 13, { width: width / 2 });
  doc.text('Debt collections are shown separately and are not counted as spending.', left + width / 2, footerY + 13, { width: width / 2, align: 'right' });

  // Bank statement style activity ledger
  const transactions = report.transactions ?? [];
  if (transactions.length) {
  doc.addPage();
  let statementY = 48;
  const drawStatementHeader = (continued = false) => {
    doc.fillColor(colors.green).font('Helvetica-Bold').fontSize(8)
      .text('LAKUWENTA  /  MONTHLY STATEMENT', left, statementY, { characterSpacing: 0.8 });
    statementY += 20;
    doc.fillColor(colors.dark).font('Helvetica-Bold').fontSize(20)
      .text(continued ? `${formatMonth(report.month)} · Continued` : formatMonth(report.month), left, statementY);
    statementY += 29;
    doc.fillColor(colors.muted).font('Helvetica').fontSize(9)
      .text('Savings contributions are transfers and are not included in expenses.', left, statementY);
    const legendY = statementY + 17;
    const legend = [
      { x: left, color: colors.green, label: 'Collections' },
      { x: left + 112, color: colors.orange, label: 'Expenses & payments' },
      { x: left + 250, color: colors.blue, label: 'Savings transfers' },
    ];
    for (const item of legend) {
      doc.fillColor(item.color).font('Helvetica-Bold').fontSize(8).text(item.label, item.x, legendY + 1);
    }
    statementY += 35;
    doc.roundedRect(left, statementY, width, 27, 6).fill(colors.pale);
    doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(7.5);
    doc.text('DATE', left + 10, statementY + 9, { characterSpacing: 0.5 });
    doc.text('DESCRIPTION', left + 82, statementY + 9, { characterSpacing: 0.5 });
    doc.text('CATEGORY / TYPE', left + 275, statementY + 9, { characterSpacing: 0.4 });
    doc.text('AMOUNT', left + 405, statementY + 9, { width: 92, align: 'right', characterSpacing: 0.5 });
    statementY += 27;
  };
  drawStatementHeader();

  for (const [index, transaction] of transactions.entries()) {
    if (statementY > doc.page.height - 87) {
      doc.addPage();
      statementY = 48;
      drawStatementHeader(true);
    }
    const rowHeight = 39;
    const inflow = transaction.type === 'DEBT_COLLECTION';
    const transfer = transaction.type === 'GOAL_CONTRIBUTION';
    const activityColor = inflow ? colors.green : transfer ? colors.blue : colors.orange;
    if (index % 2 === 1) doc.rect(left, statementY, width, rowHeight).fill('#FBFCFB');
    doc.fillColor(colors.line).rect(left, statementY + rowHeight - 0.6, width, 0.6).fill();
    doc.fillColor(colors.muted).font('Helvetica').fontSize(8.5).text(transaction.date, left + 10, statementY + 14, { width: 64 });
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(9)
      .text(transaction.name, left + 82, statementY + 13, { width: 183, ellipsis: true });
    const kind = statementType(transaction);
    doc.fillColor(activityColor).font('Helvetica').fontSize(kind.length > 21 ? 7.5 : 8.5)
      .text(kind, left + 275, statementY + 14, { width: 122, ellipsis: true });
    const displayedAmount = peso(transaction.amount);
    doc.fillColor(activityColor).font('Helvetica-Bold').fontSize(8.5)
      .text(displayedAmount, left + 397, statementY + 14, { width: 100, align: 'right', ellipsis: true });
    statementY += rowHeight;
  }

  // Add page numbers to the statement pages.
  const pageCount = doc.bufferedPageRange().count;
  for (let page = 1; page < pageCount; page += 1) {
    doc.switchToPage(page);
    // Keep footer text above PDFKit's bottom margin to avoid implicit page breaks.
    const pageFooterY = doc.page.height - 70;
    doc.fillColor(colors.line).rect(left, pageFooterY, width, 0.7).fill();
    doc.fillColor(colors.muted).font('Helvetica').fontSize(8)
      .text(`LaKuwenta  •  ${formatMonth(report.month)} statement`, left, pageFooterY + 12, { width: width - 80 });
    doc.text(`Page ${page + 1} of ${pageCount}`, left + width - 76, pageFooterY + 12, { width: 76, align: 'right' });
  }
  }

  doc.end();
  return complete;
}
