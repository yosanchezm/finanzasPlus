import { rateInForce } from '../../ledger/rateInForce.js';
import { CONVENTIONS, convertRate, normalizeRate, toEffectiveAnnual } from '../../rates.js';
import { percentText, round4 } from '../format.js';

// Facts of `rate_conventions` (spec: Rate conventions topic). The rate is the one the user stated, else the rate in force
// of the debt. Pure and read-only.

/** The rate to explain, or null: the stated rate wins over the debt's rate in force. */
export function rateOf({ projection, opts }) {
  if (opts.stated) return { rate: normalizeRate(opts.stated), dataSource: 'stated' };
  return projection ? { rate: rateInForce(projection), dataSource: 'debt' } : null;
}

/** The convention code of a rate (`EA`, `NAMV`, `MV`...), `ZERO` for an interest-free rate or `OTHER`. */
function conventionOf(rate) {
  if (rate.value === 0) return 'ZERO';
  const match = Object.keys(CONVENTIONS).find((name) => {
    const spec = CONVENTIONS[name];
    return name !== 'ZERO' && spec.basis === rate.basis && spec.periodicity === rate.periodicity && spec.timing === rate.timing;
  });
  return match || 'OTHER';
}

export function ratesFacts(ctx) {
  const found = rateOf(ctx);
  if (!found) return { status: 'generic' };
  const { rate, dataSource } = found;
  const convention = conventionOf(rate);
  const ea = round4(toEffectiveAnnual(rate));
  const monthly = round4(convertRate(rate, 'MV').value);
  // A figure the stated convention already gives (EA is the EA, MV and NAMV divide into the monthly rate) is exact;
  // every other conversion is printed rounded, so it is approximate. An interest-free rate has nothing to round.
  const exact = { EA: 'ea', MV: 'monthly', NAMV: 'monthly' }[convention];
  const approximate = convention === 'ZERO' ? [] : ['ea', 'monthly'].filter((key) => key !== exact);
  return {
    status: 'ok',
    dataSource,
    numbers: { stated: rate.value, ea, monthly },
    text: { stated: percentText(rate.value), convention, monthly: percentText(monthly), ea: percentText(ea) },
    approximate,
  };
}
