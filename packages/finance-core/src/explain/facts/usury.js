import { modalityOf } from '../../late/policy.js';
import { capOn, usuryNotice } from '../../legal.js';
import { toEffectiveAnnual } from '../../rates.js';
import { dateText, monthText, percentText, round4 } from '../format.js';
import { rateOf } from './rates.js';

// Facts of `usury_ibc` (spec: Usury and IBC topic): the cap in force for the debt's modality with its month and origin,
// the IBC behind it, and a stale or unverified warning that is shown and never blocks. No cap known is reported as such.
// The Ley 546 explanation for mortgages arrives with S3. Pure and read-only.

const IBC_MULTIPLE = 1.5; // usury = 1.5 x IBC (Codigo de Comercio, art. 884)

export function usuryFacts(ctx) {
  const { projection, legal, today } = ctx;
  const found = rateOf(ctx);
  const modality = projection ? modalityOf(projection.terms) : 'consumer';
  const numbers = {};
  const text = { modality };
  const approximate = [];
  const notices = [];
  const cap = capOn(legal.usuryTable, modality, today);
  if (cap) {
    const { entry } = cap;
    numbers.capEA = cap.capEA;
    text.cap = percentText(cap.capEA);
    text.month = monthText(entry.validFrom);
    text.origin = entry.origin || 'default';
    // A mortgage cap is manual, so it is never read back as 1.5 x IBC.
    if (modality !== 'mortgage') {
      numbers.ibcEA = entry.ibcEA === undefined ? round4(Math.round((cap.capEA / IBC_MULTIPLE) * 100) / 100) : entry.ibcEA;
      text.ibc = percentText(numbers.ibcEA);
      if (entry.ibcEA === undefined) approximate.push('ibc');
    }
    if (cap.stale) {
      notices.push({ code: 'usury_stale' });
      text.lastValidTo = dateText(cap.lastValidTo);
    }
    if (entry.verified !== true) notices.push({ code: 'usury_unverified' });
  } else {
    notices.push({ code: 'cap_unknown' });
  }
  if (!found) return { status: 'generic', numbers, text, approximate, notices };
  numbers.rateEA = round4(toEffectiveAnnual(found.rate));
  text.rateEA = percentText(numbers.rateEA);
  if (usuryNotice(found.rate, modality, today, { usuryTable: legal.usuryTable })) notices.push({ code: 'usury_above_cap' });
  return { status: 'ok', dataSource: found.dataSource, numbers, text, approximate, notices };
}
