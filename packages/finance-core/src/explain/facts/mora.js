import { addDays } from '../../calendar.js';
import { lateEAOn } from '../../late/policy.js';
import { project } from '../../ledger/project.js';
import { pesosText, percentText, round4 } from '../format.js';

// Facts of `mora` (spec: Mora topic). The policy and the rate in force come from `lateEAOn`; the figures of a loan are the
// ones the projection already computed on its overdue installment (mora is never recomputed here). When nothing is overdue
// the facts carry an approximate example of EXAMPLE_DAYS days on the next installment, measured with the same projection.
// A card gets only its policy until the card topics (S2). Pure and read-only.

const EXAMPLE_DAYS = 10;

function overdueFigures(row) {
  return {
    numbers: { lateMinor: row.lateMinor, lateDays: row.lateDays, lateBaseMinor: row.lateBaseMinor },
    text: { late: pesosText(row.lateMinor), days: String(row.lateDays), base: pesosText(row.lateBaseMinor) },
  };
}

function exampleFigures({ debt, projection, events, legal }) {
  const next = projection.nextDue || projection.plan.find((row) => row.status !== 'paid');
  if (!next) return null;
  const later = project(debt, events, addDays(next.dueOn, EXAMPLE_DAYS), { legal });
  const row = later.plan.find((item) => item.period === next.period);
  if (!row || !(row.lateMinor > 0)) return null;
  return {
    numbers: { exampleDays: EXAMPLE_DAYS, exampleBaseMinor: row.lateBaseMinor, exampleLateMinor: row.lateMinor },
    text: { exampleDays: String(EXAMPLE_DAYS), exampleBase: pesosText(row.lateBaseMinor), exampleLate: pesosText(row.lateMinor) },
  };
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
  if (projection.card) return result;
  const row = projection.plan.find((item) => item.lateMinor > 0);
  const figures = row ? overdueFigures(row) : exampleFigures(ctx);
  if (figures) {
    Object.assign(result.numbers, figures.numbers);
    Object.assign(result.text, figures.text);
    if (!row) result.approximate.push('exampleLate');
  }
  return result;
}
