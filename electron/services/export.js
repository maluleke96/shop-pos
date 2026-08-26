const XLSX = require('xlsx');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
const { pdfBytes } = require('./pdf-bytes');

function buildExcelBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.data);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  // 'array' works in browser bundle; 'buffer' needs Node Buffer
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return arr instanceof Uint8Array ? arr : new Uint8Array(arr);
}

function buildPdfBuffer(title, headers, rows, company = {}) {
  const doc = new jsPDF();
  let y = 16;

  if (company.shop_name) {
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(company.shop_name, 14, y);
    y += 8;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    if (company.address) { doc.text(company.address, 14, y); y += 5; }
    if (company.phone) { doc.text(`Tel: ${company.phone}`, 14, y); y += 5; }
    if (company.email) { doc.text(company.email, 14, y); y += 5; }
    if (company.vat_number) { doc.text(`VAT: ${company.vat_number}`, 14, y); y += 5; }
    y += 4;
    doc.setDrawColor(200);
    doc.line(14, y, 196, y);
    y += 8;
  }

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text(title, 14, y);
  y += 6;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y);
  if (company.dateRange) {
    y += 5;
    doc.text(`Period: ${company.dateRange}`, 14, y);
  }
  y += 6;

  doc.autoTable({
    head: [headers],
    body: rows,
    startY: y,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] }
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(128);
    doc.text(`${company.shop_name || 'Shop POS'} — Page ${i} of ${pageCount}`, 14, 290);
  }

  return pdfBytes(doc);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildReportHtml(title, headers, rows, company = {}) {
  const shopName = escapeHtml(company.shop_name || 'Shop POS');
  const safeHeaders = (headers || []).map(h => escapeHtml(h));
  const safeRows = (rows || []).map(r =>
    (Array.isArray(r) ? r : []).map(c => escapeHtml(c))
  );
  const headerCells = safeHeaders.map(h => `<th>${h}</th>`).join('');
  const bodyRows = safeRows.map(r =>
    `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`
  ).join('');
  const meta = [
    company.address ? `<div>${escapeHtml(company.address)}</div>` : '',
    company.phone ? `<div>Tel: ${escapeHtml(company.phone)}</div>` : '',
    company.email ? `<div>${escapeHtml(company.email)}</div>` : '',
    company.vat_number ? `<div>VAT: ${escapeHtml(company.vat_number)}</div>` : '',
    company.dateRange ? `<div>Period: ${escapeHtml(company.dateRange)}</div>` : ''
  ].filter(Boolean).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, sans-serif; margin: 0; color: #111; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .shop { font-size: 20px; font-weight: bold; margin-bottom: 6px; }
  .meta { color: #555; margin-bottom: 12px; line-height: 1.4; }
  .generated { color: #666; font-size: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #2563eb; color: #fff; font-weight: 600; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 16px; font-size: 9px; color: #888; }
</style></head><body>
  <div class="shop">${shopName}</div>
  <div class="meta">${meta}</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="generated">Generated: ${escapeHtml(new Date().toLocaleString())}</div>
  <table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows || '<tr><td colspan="' + Math.max(safeHeaders.length, 1) + '">No data</td></tr>'}</tbody></table>
  <div class="footer">${shopName} — Report</div>
</body></html>`;
}

function buildQuotePdf(quote, company = {}) {
  const doc = new jsPDF();
  const currency = company.currency || 'R';
  const fmt = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
  let y = 16;

  if (company.shop_name) {
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(company.shop_name, 14, y);
    y += 8;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    if (company.address) { doc.text(company.address, 14, y); y += 5; }
    if (company.phone) { doc.text(`Tel: ${company.phone}`, 14, y); y += 5; }
    if (company.email) { doc.text(company.email, 14, y); y += 5; }
    if (company.vat_number) { doc.text(`VAT: ${company.vat_number}`, 14, y); y += 5; }
    y += 6;
  }

  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('QUOTATION', 14, y);
  y += 8;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(`Quote No: ${quote.quote_number || '—'}`, 14, y);
  y += 6;
  doc.text(`Date: ${quote.created_at ? new Date(quote.created_at).toLocaleString() : new Date().toLocaleString()}`, 14, y);
  if (quote.valid_until) { y += 6; doc.text(`Valid Until: ${quote.valid_until}`, 14, y); }
  if (quote.customer_name) {
    y += 6;
    doc.text(`Customer: ${quote.customer_name}${quote.customer_phone ? ` (${quote.customer_phone})` : ''}`, 14, y);
  }
  if (quote.user_name) { y += 6; doc.text(`Prepared By: ${quote.user_name}`, 14, y); }

  const items = (quote.items || []).map(i => [
    String(i.product_name || ''),
    String(i.quantity ?? ''),
    fmt(i.unit_price),
    fmt(i.total)
  ]);

  doc.autoTable({
    head: [['Description', 'Qty', 'Unit Price', 'Total']],
    body: items.length ? items : [['—', '—', '—', '—']],
    startY: y + 4,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] }
  });

  let finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.text(`Subtotal: ${fmt(quote.subtotal)}`, 130, finalY, { align: 'right' });
  if (Number(quote.discount) > 0) {
    finalY += 6;
    doc.text(`Discount: -${fmt(quote.discount)}`, 130, finalY, { align: 'right' });
  }
  if (Number(quote.tax_amount) > 0) {
    finalY += 6;
    doc.text(`Tax/VAT: ${fmt(quote.tax_amount)}`, 130, finalY, { align: 'right' });
  }
  finalY += 8;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.text(`TOTAL: ${fmt(quote.total)}`, 130, finalY, { align: 'right' });
  if (quote.notes) {
    finalY += 12;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(`Notes: ${quote.notes}`, 180);
    doc.text(noteLines, 14, finalY);
  }

  return pdfBytes(doc);
}

module.exports = { buildExcelBuffer, buildPdfBuffer, buildReportHtml, buildQuotePdf };
