import { restructureCarry } from '../../ledger/restructure.js';
import { dateText, pesosText } from '../format.js';

// Facts of `restructure_whatif` (spec: Restructure and prepayment topics): what a restructure effective today would refinance
// and the principal the new debt would start from, with and without waiving the mora. The breakdown is the one
// `restructureCarry` computes (the unpaid interest, charges, taxes and mora of the installments already due, next to the whole
// balance); `refinanced` is the amount past due the projection reports (the overdue installments with their mora). Nothing is
// recomputed here and nothing is written. Pure and read-only.

export function restructureFacts({ debt, projection, events, legal, today }) {
  if (!projection) return { status: 'generic' };
  const carry = restructureCarry(debt, events, today, { legal });
  const { arrears } = carry;
  const refinanced = projection.pastDueMinor;
  const waived = carry.waivableLateMinor;
  const numbers = {
    balance: carry.balanceMinor,
    interest: arrears.interest,
    charges: arrears.charges,
    taxes: arrears.taxes,
    late: arrears.lateInterest,
    refinanced,
    refinancedWaived: refinanced - waived,
    newBalance: carry.carriedMinor,
    newBalanceWaived: carry.carriedMinor - waived,
  };
  const text = { asOf: dateText(today) };
  for (const key of Object.keys(numbers)) text[key] = pesosText(numbers[key]);
  const notices = [];
  if (refinanced === 0 && carry.carriedMinor === carry.balanceMinor) notices.push({ code: 'nothing_overdue' });
  else if (waived === 0) notices.push({ code: 'no_late' });
  if (projection.terms.kind === 'mortgage' && arrears.lateInterest > 0) notices.push({ code: 'late_mortgage_unverified' });
  return { status: 'ok', dataSource: 'debt', numbers, text, approximate: [], notices };
}
