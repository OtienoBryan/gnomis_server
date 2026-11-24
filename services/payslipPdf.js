const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const LOGO_PATH = path.join(__dirname, '..', '..', 'client', 'public', 'logo.jpg');

const kes = (n) =>
  `KES ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) => {
  const date = new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return isNaN(date.getTime())
    ? String(d || '')
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Renders a staff payslip (same layout as the /payroll-management/payslip/:id page) and resolves to a Buffer.
 * `slip` is the object returned by staffPayrollController's payslip loader.
 */
const buildStaffPayslipPdf = (slip) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const right = doc.page.width - 40;
    const width = right - left;
    const dark = '#111827';
    const grey = '#6b7280';
    const light = '#9ca3af';
    const line = '#e5e7eb';
    const red = '#dc2626';
    const green = '#15803d';

    // Company line
    let y = 40;
    if (fs.existsSync(LOGO_PATH)) {
      try {
        doc.image(LOGO_PATH, left, y, { fit: [80, 45] });
      } catch (_) { /* logo is optional */ }
    }
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(12).text('GNOMIS QUALITY PRODUCTS', left, y, { width, align: 'right' });
    doc.fillColor(grey).font('Helvetica').fontSize(8.5)
      .text('P.O Box 15470, Nairobi Kenya', { width, align: 'right' })
      .text('Pin P051904794X', { width, align: 'right' });
    y = 100;

    // Red header band: PAYSLIP / Pay date
    doc.rect(left, y, width, 56).fill(red);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text('PAYSLIP', left + 18, y + 12);
    doc.font('Helvetica').fontSize(9).fillOpacity(0.85).text('Staff payroll', left + 18, y + 34);
    doc.fillOpacity(0.85).fontSize(8.5).text('Pay date', left, y + 14, { width: width - 18, align: 'right' });
    doc.fillOpacity(1).font('Helvetica-Bold').fontSize(11).text(fmtDate(slip.pay_date), left, y + 27, { width: width - 18, align: 'right' });
    y += 56 + 18;

    // Employee (left) / Pay period (right)
    const colW = width / 2 - 10;
    const blockTop = y;
    doc.fillColor(light).font('Helvetica').fontSize(7.5).text('EMPLOYEE', left + 18, y, { characterSpacing: 0.8 });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text(slip.staff_name || '', left + 18, doc.y + 3, { width: colW });
    doc.fillColor(grey).font('Helvetica').fontSize(9);
    const role = slip.staff_designation || slip.staff_role || 'Staff';
    doc.text(role.charAt(0).toUpperCase() + role.slice(1), { width: colW });
    if (slip.staff_department) doc.text(slip.staff_department, { width: colW });
    if (slip.staff_empl_no) doc.text(`Employee # ${slip.staff_empl_no}`, { width: colW });
    if (slip.staff_email) doc.text(slip.staff_email, { width: colW });
    const leftBottom = doc.y;

    const rx = left + width / 2;
    const rw = width / 2 - 18;
    doc.fillColor(light).font('Helvetica').fontSize(7.5).text('PAY PERIOD', rx, blockTop, { width: rw, align: 'right', characterSpacing: 0.8 });
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(11)
      .text(`${fmtDate(slip.period_start)} - ${fmtDate(slip.period_end)}`, rx, doc.y + 3, { width: rw, align: 'right' });
    doc.fillColor(grey).font('Helvetica').fontSize(9)
      .text(`${Number(slip.days_paid)} of ${slip.working_days} working days paid`, { width: rw, align: 'right' });
    if (slip.journal_entry_id) {
      doc.fillColor(light).text(`Journal entry #${slip.journal_entry_id}`, { width: rw, align: 'right' });
    }
    y = Math.max(leftBottom, doc.y) + 16;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(line).stroke();
    y += 18;

    const inner = left + 18;
    const innerW = width - 36;

    const sectionTitle = (title) => {
      doc.fillColor(grey).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), inner, y, { characterSpacing: 0.8 });
      y = doc.y + 4;
    };

    // One row: label (+ optional hint) left, value right, divider below
    const row = (labelText, value, { hint, color = dark, bold = false } = {}) => {
      const top = y + 7;
      doc.fillColor('#1f2937').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(labelText, inner, top, { width: innerW - 140 });
      let bottom = doc.y;
      if (hint) {
        doc.fillColor(light).font('Helvetica').fontSize(8).text(hint, inner, bottom + 1, { width: innerW - 140 });
        bottom = doc.y;
      }
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(value, inner, top, { width: innerW, align: 'right' });
      y = bottom + 7;
      doc.moveTo(inner, y).lineTo(inner + innerW, y).lineWidth(0.5).strokeColor('#f3f4f6').stroke();
    };

    // Earnings
    sectionTitle('Earnings');
    row('Basic salary', kes(slip.basic_salary));
    row('Gross pay', kes(slip.gross_pay), { hint: `Prorated: ${Number(slip.days_paid)}/${slip.working_days} days`, bold: true });
    y += 18;

    // Deductions
    sectionTitle('Deductions');
    const deductions = slip.deductions || [];
    if (deductions.length === 0) {
      doc.fillColor(light).font('Helvetica').fontSize(10).text('No deductions for this pay period', inner, y + 7);
      y = doc.y + 7;
    } else {
      deductions.forEach((d) => row(d.name, `- ${kes(d.amount)}`, { hint: d.account || undefined, color: red }));
    }
    row('Total deductions', `- ${kes(slip.total_deductions)}`, { color: red, bold: true });
    y += 20;

    // Net pay box
    doc.roundedRect(inner, y, innerW, 44, 6).fillAndStroke('#f0fdf4', '#bbf7d0');
    doc.fillColor(dark).font('Helvetica-Bold').fontSize(11).text('Net pay', inner + 14, y + 16);
    doc.fillColor(green).font('Helvetica-Bold').fontSize(16).text(kes(slip.net_pay), inner, y + 13, { width: innerW - 14, align: 'right' });
    y += 44 + 16;

    if (slip.notes) {
      doc.fillColor(grey).font('Helvetica').fontSize(8.5).text(`Notes: ${slip.notes}`, inner, y, { width: innerW });
      y = doc.y + 10;
    }

    doc.fillColor(light).font('Helvetica').fontSize(7.5)
      .text('This is a computer-generated payslip and does not require a signature.', left, doc.page.height - 60, { width, align: 'center' });

    doc.end();
  });

module.exports = { buildStaffPayslipPdf };
