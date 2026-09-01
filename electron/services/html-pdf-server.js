/**
 * Server-side HTML → PDF (Railway / RPC — no Electron BrowserWindow).
 */
const { jsPDF } = require('jspdf');

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToPdf(html, options = {}) {
  const widthMm = Number(options.widthMm) || 210;
  const heightMm = Number(options.heightMm) || 297;
  const orientation = widthMm > heightMm ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'mm', format: [widthMm, heightMm] });
  const text = stripHtml(html);
  const margin = 10;
  const maxWidth = widthMm - margin * 2;
  const lines = doc.splitTextToSize(text || ' ', maxWidth);
  let y = margin;
  const lineHeight = 5;
  const pageHeight = heightMm - margin;
  for (const line of lines) {
    if (y > pageHeight) {
      doc.addPage([widthMm, heightMm], orientation);
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }
  return Buffer.from(doc.output('arraybuffer'));
}

module.exports = { htmlToPdf, stripHtml };
