import { ley1555Notice } from '../../legal.js';
import { compareStrategies } from '../../prepay/compare.js';
import { dateText, pesosText, percentText } from '../format.js';

// Facts of `prepayment` (spec: Restructure and prepayment topics): the same extra payment under the strategies
// `compareStrategies` simulates (reduce the term, reduce the installment), plus the Ley 1555 notice with its unverified-scope
// caveat. The comparison is the core's (nothing is simulated here, nothing is written); the extra is the amount the user
// stated, and without one only the notice is shown. The notice of the core is only raised for mortgages, but it also carries
// the scope threshold (880 monthly minimum wages), so it is read with the mortgage kind to get that threshold for any loan:
// the facts always say the scope is unverified. Pure and read-only.

const validAmount = (amountMinor) => Number.isSafeInteger(amountMinor) && amountMinor > 0;

// The threshold of the notice for this debt, as figures and text. A year with no minimum wage known gives no threshold.
function ley1555Facts({ projection, legal, today }, numbers, text, notices) {
  const notice = ley1555Notice({ kind: 'mortgage', principalMinor: projection.terms.principalMinor }, today, { smmlvTable: legal.smmlvTable });
  notices.push({ code: notice.code });
  if (notice.thresholdMinor === null) {
    text.scope = 'unknown';
    return;
  }
  numbers.smmlv = notice.smmlvMinor;
  numbers.threshold = notice.thresholdMinor;
  text.smmlv = pesosText(notice.smmlvMinor);
  text.threshold = pesosText(notice.thresholdMinor);
  text.smmlvCount = String(Math.round(notice.thresholdMinor / notice.smmlvMinor));
  text.scope = notice.aboveThreshold === null ? 'unknown' : notice.aboveThreshold ? 'above' : 'within';
  if (notice.smmlvStale) notices.push({ code: 'smmlv_stale' });
}

function comparisonFacts(comparison, numbers, text, approximate, notices) {
  const { reduceTerm, reduceInstallment } = comparison;
  const figures = {
    periodsBefore: reduceTerm.before.remainingPeriods,
    installmentBefore: reduceTerm.before.installmentMinor,
    termPeriods: reduceTerm.after.remainingPeriods,
    termInstallment: reduceTerm.after.installmentMinor,
    termSaved: reduceTerm.savings.interestMinor,
    installPeriods: reduceInstallment.after.remainingPeriods,
    installInstallment: reduceInstallment.after.installmentMinor,
    installSaved: reduceInstallment.savings.interestMinor,
  };
  Object.assign(numbers, figures);
  for (const key of Object.keys(figures)) text[key] = key.endsWith('Periods') || key === 'periodsBefore' ? String(figures[key]) : pesosText(figures[key]);
  // What is simulated again on a new schedule (the recomputed installment, the interest saved) is a projection, not a quote.
  approximate.push('installInstallment');
  for (const key of ['termSaved', 'installSaved']) if (figures[key] > 0) approximate.push(key);
  if (comparison.identical) notices.push({ code: 'strategies_identical' });
  if (reduceTerm.paidOff) notices.push({ code: 'paid_off' });
  if (reduceTerm.penaltyPct > 0) {
    notices.push({ code: 'penalty_registered' });
    numbers.penaltyPct = reduceTerm.penaltyPct;
    text.penaltyPct = percentText(reduceTerm.penaltyPct);
  }
}

export function prepaymentFacts(ctx) {
  const { debt, projection, events, legal, today, opts } = ctx;
  if (!projection) return { status: 'generic' };
  const numbers = {};
  const text = {};
  const approximate = [];
  const notices = [];
  if (projection.balanceMinor <= 0) notices.push({ code: 'nothing_owed' });
  else if (!validAmount(opts.amountMinor)) notices.push({ code: 'no_amount' });
  ley1555Facts(ctx, numbers, text, notices);
  if (notices.some((notice) => notice.code === 'nothing_owed' || notice.code === 'no_amount')) {
    return { status: 'ok', dataSource: 'debt', numbers, text, approximate, notices };
  }
  const comparison = compareStrategies({ ...debt, legal }, events, { amountMinor: opts.amountMinor, on: today });
  numbers.amount = opts.amountMinor;
  text.amount = pesosText(opts.amountMinor);
  text.onDate = dateText(today);
  comparisonFacts(comparison, numbers, text, approximate, notices);
  if (projection.terms.kind === 'mortgage') notices.push({ code: 'mortgage' });
  return { status: 'ok', dataSource: 'debt', numbers, text, approximate, notices };
}
