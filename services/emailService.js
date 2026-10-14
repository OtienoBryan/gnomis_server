const { Resend } = require('resend');
const { buildInvoicePdf } = require('./invoicePdf');

let resendClient = null;
const getClient = () => {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured on the server');
  }
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
};

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const cell = 'border:1px solid #e5e7eb;padding:6px';

const buildInvoiceHtml = (order, invoiceNumber, message) => {
  const rows = (order.items || [])
    .map((item) => {
      const tax = Number(item.tax_amount) || 0;
      const qty = Number(item.quantity) || 0;
      return `<tr>
        <td style="${cell}">${escapeHtml(item.product_name || `Product ${item.product_id}`)}</td>
        <td style="${cell};text-align:right">${qty.toFixed(2)}</td>
        <td style="${cell};text-align:right">${money(qty ? Number(item.total_price) / qty : 0)}</td>
        <td style="${cell}">${tax > 0 ? 'Sales VAT (16%)' : 'Sales VAT Zero Rated'}</td>
        <td style="${cell};text-align:right">${money(item.total_price)} KSh</td>
      </tr>`;
    })
    .join('');

  const total = Number(order.total_amount) || 0;
  const tax = Number(order.tax_amount) || 0;
  const date = order.order_date ? new Date(order.order_date).toLocaleDateString('en-GB') : '';

  return `<div style="font-family:Arial,sans-serif;color:#374151;max-width:700px;margin:0 auto;font-size:13px">
    <h2 style="margin:0 0 4px">GNOMIS QUALITY PRODUCTS</h2>
    <p style="margin:0;color:#6b7280;font-size:11px">P.O Box 15470, Nairobi Kenya &middot; Pin P051904794X</p>
    <hr style="border:0;border-top:2px solid #e5e7eb;margin:12px 0">
    ${message
      ? `<p style="white-space:pre-line">${escapeHtml(message)}</p>`
      : `<p>Dear ${escapeHtml(order.name || 'Customer')},</p><p>Please find your invoice below.</p>`}
    <h3 style="margin:16px 0 4px">Invoice ${escapeHtml(invoiceNumber)}</h3>
    <p style="margin:0;font-size:12px">Invoice Date: ${escapeHtml(date)} &middot; Order: ${escapeHtml(order.so_number)}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:12px">
      <thead><tr style="background:#f9fafb">
        <th style="${cell};text-align:left">DESCRIPTION</th>
        <th style="${cell};text-align:right">QUANTITY</th>
        <th style="${cell};text-align:right">UNIT PRICE</th>
        <th style="${cell};text-align:left">TAXES</th>
        <th style="${cell};text-align:right">AMOUNT</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table style="margin:12px 0 0 auto;border-collapse:collapse;font-size:12px;min-width:260px">
      <tr><td style="${cell}">Untaxed Amount</td><td style="${cell};text-align:right">${money(total - tax)} KSh</td></tr>
      <tr><td style="${cell}">VAT 16%</td><td style="${cell};text-align:right">${money(tax)} KSh</td></tr>
      <tr style="background:#374151;color:#fff;font-weight:bold"><td style="padding:6px">Total</td><td style="padding:6px;text-align:right">${money(total)} KSh</td></tr>
    </table>
  </div>`;
};

const sendInvoiceEmail = async ({ to, cc, subject, message, order, invoiceNumber }) => {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error('RESEND_FROM_EMAIL is not configured on the server');
  const pdf = await buildInvoicePdf(order, invoiceNumber);
  const { data, error } = await getClient().emails.send({
    from,
    to: [to],
    ...(Array.isArray(cc) && cc.length > 0 ? { cc } : {}),
    subject: subject || `Invoice ${invoiceNumber} from Gnomis Quality Products`,
    html: buildInvoiceHtml(order, invoiceNumber, message),
    attachments: [{ filename: `invoice-${invoiceNumber.replace(/\//g, '-')}.pdf`, content: pdf }],
  });
  if (error) throw new Error(error.message || 'Resend failed to send the email');
  return data;
};

module.exports = { sendInvoiceEmail };
