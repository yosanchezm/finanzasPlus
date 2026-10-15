import { planCommit } from '../../ledger/commit.js';
import { dateText, pesosText } from '../format.js';

// Facts of `payment_allocation` (spec: Payment allocation topic): how a payment is split into charges and taxes, mora,
// interest and principal. The split is the one `planCommit` computes for a payment draft (event id 'explain'), a pure
// preview that writes nothing. The payment is the stated amount, else what is due on the next installment (mora included).
// A card has its own allocation (S2), so it is answered generically for now. Pure and read-only.

const KEYS = [
  ['charges', 'charges'],
  ['taxes', 'taxes'],
  ['late', 'lateInterest'],
  ['interest', 'interest'],
  ['principal', 'principal'],
  ['surplus', 'surplus'],
];

export function allocationFacts({ debt, projection, events, legal, today, opts }) {
  if (!projection || projection.card) return { status: 'generic' };
  const stated = opts.amountMinor !== undefined && opts.amountMinor !== null;
  const amountMinor = stated ? opts.amountMinor : projection.nextDue && projection.nextDue.outstandingMinor;
  const result = { status: 'ok', dataSource: 'debt', numbers: {}, text: {}, approximate: [], notices: [] };
  if (!(amountMinor > 0)) {
    result.notices.push({ code: 'nothing_due' });
    return result;
  }
  const draft = { kind: 'payment', effectiveOn: today, amountMinor };
  const ctx = { eventId: 'explain', dedupeKey: 'explain', actorId: 'explain', source: 'telegram', asOf: today };
  const { allocation } = planCommit({ ...debt, householdId: debt.householdId || 'explain', legal }, events, draft, ctx);
  if (!allocation) {
    result.notices.push({ code: 'nothing_due' });
    return result;
  }
  result.numbers.payment = amountMinor;
  result.text = { payment: pesosText(amountMinor), paidOn: dateText(today), amountSource: stated ? 'stated' : 'next_due' };
  for (const [key, field] of KEYS) {
    result.numbers[key] = allocation[field];
    result.text[key] = pesosText(allocation[field]);
  }
  return result;
}
