import { addDays } from '../../calendar.js';
import { lateEAOn } from '../../late/policy.js';
import { project } from '../../ledger/project.js';
import { pesosText, percentText, round4 } from '../format.js';

// Facts of `mora` (spec: Mora topic). The policy and the rate in force come from `lateEAOn`; the figures of a loan are the
// ones the projection already computed on its overdue installment (mora is never recomputed here). When nothing is overdue
// the facts carry an approximate example of EXAMPLE_DAYS days on the next installment, measured with the same projection.
// A card runs mora on the unmet capital of the minimum payment: the facts add the minimum, the interest, fees and taxes that
// payments settle first (non capital) and the capital that is left, and every card figure is approximate (the mora is billed
// at the next statement). Pure and read-only.

const EXAMPLE_DAYS = 10;

function overdueFigures(row) {
  return {
    numbers: { lateMinor: row.lateMinor, lateDays: row.lateDays, lateBaseMinor: row.lateBaseMinor },
    text: { late: pesosText(row.lateMinor), days: String(row.lateDays), base: pesosText(row.lateBaseMinor) },
  };
}

/** The minimum of a statement split as the core settles it: interest, fees, taxes and mora first, the capital last. */
function minimumFigures(row) {
  const nonCapital = Math.min(row.minimumMinor, row.interestMinor + row.chargesMinor + row.taxesMinor + row.lateInterestMinor);
  const capital = row.minimumMinor - nonCapital;
  return {
    numbers: { minimum: row.minimumMinor, nonCapital, capital },
    text: { minimum: pesosText(row.minimumMinor), nonCapital: pesosText(nonCapital), capital: pesosText(capital) },
  };
}

function exampleFigures({ debt, projection, events, legal }) {
  const next = projection.nextDue || projection.plan.find((row) => row.status !== 'paid');
  if (!next) return null;
  const later = project(debt, events, addDays(next.dueOn, EXAMPLE_DAYS), { legal });
  const row = later.plan.find((item) => item.period === next.period);
  if (!row || !(row.lateMinor > 0)) return null;
  // A card's mora stops at the next statement, so the example shows the days it really runs.
  const exampleDays = projection.card ? row.lateDays : EXAMPLE_DAYS;
  const figures = {
    numbers: { exampleDays, exampleBaseMinor: row.lateBaseMinor, exampleLateMinor: row.lateMinor },
    text: { exampleDays: String(exampleDays), exampleBase: pesosText(row.lateBaseMinor), exampleLate: pesosText(row.lateMinor) },
  };
  if (projection.card) {
    const minimum = minimumFigures(next);
    Object.assign(figures.numbers, minimum.numbers);
    Object.assign(figures.text, minimum.text);
  }
  return figures;
}

export function moraFacts(ctx) {
  const { projection, legal, today } = ctx;
  if (!projection) return { status: 'generic' };
  const mode = (projection.terms.late && projection.terms.late.mode) || 'none';
  const result = { status: 'ok', dataSource: 'debt', numbers: {}, text: { mode }, approximate: [], notices: [] };
  if (mode === 'none') return result;
  const { ea, notices } = lateEAOn(projection.terms, today, legal);
  result.numbers.lateEA = round4(ea);
  result.text.lateEA = percentText(ea);
  result.notices = notices.map(({ code }) => ({ code }));
  const row = projection.plan.find((item) => item.lateMinor > 0);
  const figures = row ? overdueFigures(row) : exampleFigures(ctx);
  if (figures) {
    Object.assign(result.numbers, figures.numbers);
    Object.assign(result.text, figures.text);
    if (row && projection.card) {
      const minimum = minimumFigures(row);
      Object.assign(result.numbers, minimum.numbers);
      Object.assign(result.text, minimum.text);
    }
    if (!row) result.approximate.push('exampleLate');
    else if (projection.card) result.approximate.push('late');
  }
  return result;
}
