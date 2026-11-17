/**
 * Payroll calculation engine (pure functions, no DB access).
 *
 * Statutory rules are data-driven (see payroll_statutory_rules). Each rule has a `method`:
 *   - percentage : employee_rate / employer_rate (%) of the rule's `base` (gross | basic | taxable),
 *                  limited to `earnings_ceiling` (max earnings considered), then clamped to
 *                  [min_amount, max_amount] per party.
 *   - flat       : employee_amount / employer_amount fixed per employee per month.
 *   - bands      : progressive tax bands (PAYE) on taxable income less `relief_amount`.
 *
 * Rules with `tax_deductible = 1` (e.g. NSSF, SHIF, Housing Levy) reduce taxable income before
 * the `bands` rule (PAYE) is applied, so non-band rules are computed first.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

const parseBands = (bands) => {
  if (!bands) return [];
  if (Array.isArray(bands)) return bands;
  try {
    const parsed = JSON.parse(bands);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Progressive tax. bands: [{ upto: number|null, rate: percent }] ascending; null upto = no limit. */
const calculateBandedTax = (taxableIncome, bands) => {
  let remaining = Math.max(0, taxableIncome);
  let previousLimit = 0;
  let tax = 0;
  for (const band of bands) {
    if (remaining <= 0) break;
    const upto = band.upto === null || band.upto === undefined || band.upto === '' ? Infinity : Number(band.upto);
    const width = upto - previousLimit;
    const slice = Math.min(remaining, width);
    tax += slice * (Number(band.rate) / 100);
    remaining -= slice;
    previousLimit = upto;
  }
  return tax;
};

const baseAmount = (rule, figures) => {
  switch (rule.base) {
    case 'basic': return figures.basic;
    case 'taxable': return figures.taxableGross;
    default: return figures.gross;
  }
};

const clamp = (value, min, max) => {
  let v = value;
  if (min !== null && min !== undefined && min !== '' && v < Number(min)) v = Number(min);
  if (max !== null && max !== undefined && max !== '' && v > Number(max)) v = Number(max);
  return v;
};

/**
 * Compute one employee's payslip figures.
 *
 * @param {object} input
 * @param {number} input.basic              Monthly basic salary
 * @param {number} [input.unpaidDays]       Unpaid days to deduct from basic
 * @param {number} [input.daysInMonth]      Divisor for proration (default 30)
 * @param {Array}  [input.allowances]       [{ name, amount, taxable }]
 * @param {number} [input.extraEarnings]    One-off taxable earnings (bonus, overtime)
 * @param {Array}  [input.deductions]       [{ name, amount }] recurring non-statutory deductions
 * @param {number} [input.extraDeductions]  One-off deductions
 * @param {Array}  [input.loans]            [{ id, name, amount }] instalments due this run
 * @param {string[]} [input.exemptCodes]    Statutory rule codes this employee is exempt from
 * @param {Array}  rules                    Active statutory rules
 */
const calculatePayslip = (input, rules) => {
  const daysInMonth = input.daysInMonth || 30;
  const unpaidDays = Math.min(num(input.unpaidDays), daysInMonth);
  const basicFull = num(input.basic);
  const basic = round2(basicFull * (1 - unpaidDays / daysInMonth));

  const allowances = (input.allowances || []).map((a) => ({
    name: a.name,
    amount: round2(num(a.amount)),
    taxable: a.taxable === undefined ? true : !!a.taxable,
  }));
  const extraEarnings = round2(num(input.extraEarnings));
  const allowancesTotal = round2(allowances.reduce((s, a) => s + a.amount, 0));

  const gross = round2(basic + allowancesTotal + extraEarnings);
  const taxableGross = round2(
    basic + extraEarnings + allowances.filter((a) => a.taxable).reduce((s, a) => s + a.amount, 0)
  );
  const figures = { basic, gross, taxableGross };
  const exempt = new Set((input.exemptCodes || []).map((c) => String(c).trim().toUpperCase()));

  const statutory = []; // [{ rule_id, code, name, employee, employer }]
  let taxDeductibleTotal = 0;

  const activeRules = rules.filter((r) => r.is_active === undefined || !!r.is_active);
  const ordered = [...activeRules].sort((a, b) => {
    const ab = a.method === 'bands' ? 1 : 0;
    const bb = b.method === 'bands' ? 1 : 0;
    return ab - bb || num(a.sort_order) - num(b.sort_order);
  });

  for (const rule of ordered) {
    const code = String(rule.code || '').toUpperCase();
    let employee = 0;
    let employer = 0;

    if (!exempt.has(code)) {
      if (rule.method === 'percentage') {
        let base = baseAmount(rule, figures);
        if (rule.earnings_ceiling !== null && rule.earnings_ceiling !== undefined && rule.earnings_ceiling !== '') {
          base = Math.min(base, Number(rule.earnings_ceiling));
        }
        employee = num(rule.employee_rate) > 0 ? clamp(base * (num(rule.employee_rate) / 100), rule.min_amount, rule.max_amount) : 0;
        employer = num(rule.employer_rate) > 0 ? clamp(base * (num(rule.employer_rate) / 100), null, rule.max_amount) : 0;
        if (base <= 0) { employee = 0; employer = 0; }
      } else if (rule.method === 'flat') {
        employee = num(rule.employee_amount);
        employer = num(rule.employer_amount);
        if (gross <= 0) { employee = 0; employer = 0; }
      } else if (rule.method === 'bands') {
        const taxable = Math.max(0, taxableGross - taxDeductibleTotal);
        const tax = calculateBandedTax(taxable, parseBands(rule.bands));
        employee = Math.max(0, tax - num(rule.relief_amount));
        if (taxable <= 0) employee = 0;
      }
    }

    employee = round2(employee);
    employer = round2(employer);
    if (rule.method !== 'bands' && rule.tax_deductible) taxDeductibleTotal += employee;

    statutory.push({
      rule_id: rule.id,
      code: rule.code,
      name: rule.name,
      employee,
      employer,
      account_id: rule.account_id || null,
      employer_account_id: rule.employer_account_id || null,
    });
  }

  const deductions = (input.deductions || []).map((d) => ({ name: d.name, amount: round2(num(d.amount)) }));
  const loans = (input.loans || []).map((l) => ({ id: l.id, name: l.name, amount: round2(num(l.amount)) }));
  const otherDeductions = round2(deductions.reduce((s, d) => s + d.amount, 0) + num(input.extraDeductions));
  const loanDeductions = round2(loans.reduce((s, l) => s + l.amount, 0));
  const statutoryEmployee = round2(statutory.reduce((s, r) => s + r.employee, 0));
  const statutoryEmployer = round2(statutory.reduce((s, r) => s + r.employer, 0));
  const totalDeductions = round2(statutoryEmployee + otherDeductions + loanDeductions);
  const netPay = round2(gross - totalDeductions);

  const paye = statutory.find((r) => String(r.code).toUpperCase() === 'PAYE');

  return {
    basic_full: round2(basicFull),
    basic,
    unpaid_days: unpaidDays,
    allowances,
    allowances_total: allowancesTotal,
    extra_earnings: extraEarnings,
    gross_pay: gross,
    taxable_gross: taxableGross,
    taxable_income: round2(Math.max(0, taxableGross - taxDeductibleTotal)),
    statutory,
    statutory_employee: statutoryEmployee,
    statutory_employer: statutoryEmployer,
    paye: paye ? paye.employee : 0,
    deductions,
    extra_deductions: round2(num(input.extraDeductions)),
    other_deductions: otherDeductions,
    loans,
    loan_deductions: loanDeductions,
    total_deductions: totalDeductions,
    net_pay: netPay,
    employer_cost: round2(gross + statutoryEmployer),
    warning: netPay < 0 ? 'Deductions exceed gross pay' : null,
  };
};

module.exports = { calculatePayslip, calculateBandedTax, round2 };
