const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '..', '..', 'client', 'public', 'logo.jpg');

const money = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Renders the invoice (same layout as the /sales-order-invoice page) and resolves to a Buffer
const buildInvoicePdf = (order, invoiceNumber) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const right = doc.page.width - 40;
    const width = right - left;
    const grey = '#6b7280';
    const dark = '#1f2937';
    const line = '#e5e7eb';

    // Header: logo left, company right
    if (fs.existsSync(LOGO_PATH)) {
      try {
        doc.image(LOGO_PATH, left, 40, { fit: [100, 60] });
      } catch (_) { /* logo is optional */ }
    }
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(13)
      .text('GNOMIS QUALITY PRODUCTS', left, 40, { width, align: 'right' });
    doc.fillColor(grey).font('Helvetica').fontSize(9)
      .text('P.O Box 15470, Nairobi Kenya', { width, align: 'right' })
      .text('Pin P051904794X', { width, align: 'right' });

    // Customer block (right aligned)
    doc.moveDown(1.2);
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(10).text(order.name || 'N/A', left, doc.y, { width, align: 'right' });
    doc.fillColor(grey).font('Helvetica').fontSize(9);
    if (order.contact) doc.text(order.contact, { width, align: 'right' });
    if (order.tax_pin) doc.text(`Tax ID: ${order.tax_pin}`, { width, align: 'right' });

    let y = Math.max(doc.y + 8, 125);
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1.5).strokeColor(line).stroke();
    y += 14;

    // Title + meta
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(18).text(`Invoice ${invoiceNumber}`, left, y);
    y = doc.y + 8;
    const date = order.order_date ? new Date(order.order_date).toLocaleDateString('en-GB') : '-';
    const due = (order.expected_delivery_date || order.order_date)
      ? new Date(order.expected_delivery_date || order.order_date).toLocaleDateString('en-GB')
      : '-';
    [['Invoice Date:', date], ['Due Date:', due], ['Source:', order.so_number || '-']].forEach(([label, value], i) => {
      const x = left + i * 150;
      doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text(label, x, y);
      doc.fillColor(grey).font('Helvetica').fontSize(9).text(String(value), x, y + 12);
    });
    y += 38;

    // Items table
    const cols = [
      { label: 'DESCRIPTION', w: 0.38, align: 'left' },
      { label: 'QUANTITY', w: 0.12, align: 'right' },
      { label: 'UNIT PRICE', w: 0.15, align: 'right' },
      { label: 'TAXES', w: 0.20, align: 'left' },
      { label: 'AMOUNT', w: 0.15, align: 'right' },
    ];
    const colX = [];
    let cx = left;
    cols.forEach((c) => { colX.push(cx); cx += c.w * width; });
    const drawRow = (cells, rowY, { header = false } = {}) => {
      const h = 20;
      if (header) doc.rect(left, rowY, width, h).fillColor('#f9fafb').fill();
      doc.rect(left, rowY, width, h).lineWidth(0.5).strokeColor(line).stroke();
      doc.fillColor(header ? '#374151' : '#374151').font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      cells.forEach((text, i) => {
        doc.text(String(text), colX[i] + 5, rowY + 6, {
          width: cols[i].w * width - 10,
          align: cols[i].align,
          lineBreak: false,
          ellipsis: true,
        });
      });
      return rowY + h;
    };

    y = drawRow(cols.map((c) => c.label), y, { header: true });
    (order.items || []).forEach((item) => {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
        y = drawRow(cols.map((c) => c.label), y, { header: true });
      }
      const tax = Number(item.tax_amount) || 0;
      const qty = Number(item.quantity) || 0;
      // VAT-inclusive unit price (LPO price) so quantity x price = amount
      y = drawRow([
        item.product_name || `Product ${item.product_id}`,
        qty.toFixed(2),
        money(qty ? Number(item.total_price) / qty : 0),
        tax > 0 ? 'Sales VAT (16%)' : 'Sales VAT Zero Rated',
        `${money(item.total_price)} KSh`,
      ], y);
    });

    // Totals
    const total = Number(order.total_amount) || 0;
    const tax = Number(order.tax_amount) || 0;
    if (y > doc.page.height - 200) { doc.addPage(); y = 40; }
    y += 14;
    const tw = 260;
    const tx = right - tw;
    const totals = [
      ['Untaxed Amount', `${money(total - tax)} KSh`],
      ['VAT 16%', `${money(tax)} KSh`],
      ['Total', `${money(total)} KSh`, true],
    ];
    totals.forEach(([label, value, strong]) => {
      const h = 18;
      if (strong) doc.rect(tx, y, tw, h).fillColor('#374151').fill();
      else doc.rect(tx, y, tw, h).lineWidth(0.5).strokeColor(line).stroke();
      doc.fillColor(strong ? '#ffffff' : '#374151').font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      doc.text(label, tx + 6, y + 5, { width: tw / 2, lineBreak: false });
      doc.text(value, tx + tw / 2, y + 5, { width: tw / 2 - 6, align: 'right', lineBreak: false });
      y += h;
    });

    doc.end();
  });

module.exports = { buildInvoicePdf };
