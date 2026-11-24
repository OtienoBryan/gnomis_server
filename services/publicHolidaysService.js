const db = require('../database/db');

/**
 * Public holiday resolution with yearly recurrence.
 *
 * Rules:
 * - A holiday row marked is_recurring repeats on the same month/day every following year.
 * - If a year has its own row for the same holiday (same name + country), that row wins
 *   for that year (i.e. the occurrence was edited) and becomes the template for later years.
 * - If the latest row before a year is not recurring, the holiday does not repeat.
 */

const pad = (n) => String(n).padStart(2, '0');
const yearOf = (dateStr) => Number(String(dateStr).slice(0, 4));
const keyOf = (h) => `${String(h.name).trim().toLowerCase()}|${String(h.country || 'Kenya').toLowerCase()}`;

const projectDate = (dateStr, year) => {
  const month = Number(String(dateStr).slice(5, 7));
  let day = Number(String(dateStr).slice(8, 10));
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) day = daysInMonth; // e.g. Feb 29 in a non-leap year
  return `${year}-${pad(month)}-${pad(day)}`;
};

/**
 * Returns holidays (stored + projected recurring occurrences) with date between
 * startDate and endDate inclusive (YYYY-MM-DD strings), sorted by date.
 */
async function getHolidaysInRange(startDate, endDate, country) {
  const params = [endDate.slice(0, 4) + '-12-31'];
  let where = 'WHERE date <= ?';
  if (country) {
    where += ' AND country = ?';
    params.push(country);
  }
  const [rows] = await db.query(
    `SELECT id, name, DATE_FORMAT(date, '%Y-%m-%d') AS date, country, is_recurring
     FROM public_holidays ${where}
     ORDER BY date ASC`,
    params
  );

  // Group rows by holiday identity
  const groups = new Map();
  for (const r of rows) {
    r.is_recurring = !!r.is_recurring;
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const result = [];
  const startYear = yearOf(startDate);
  const endYear = yearOf(endDate);

  for (const groupRows of groups.values()) {
    for (let y = startYear; y <= endYear; y++) {
      const ownRows = groupRows.filter((r) => yearOf(r.date) === y);
      if (ownRows.length > 0) {
        for (const r of ownRows) {
          if (r.date >= startDate && r.date <= endDate) {
            result.push({ ...r, is_projected: false });
          }
        }
        continue;
      }
      // Latest earlier occurrence acts as the template
      const earlier = groupRows.filter((r) => yearOf(r.date) < y);
      const template = earlier[earlier.length - 1];
      if (!template || !template.is_recurring) continue;
      const date = projectDate(template.date, y);
      if (date >= startDate && date <= endDate) {
        result.push({
          id: `r-${template.id}-${y}`,
          source_id: template.id,
          name: template.name,
          date,
          country: template.country,
          is_recurring: true,
          is_projected: true,
        });
      }
    }
  }

  result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return result;
}

module.exports = { getHolidaysInRange };
