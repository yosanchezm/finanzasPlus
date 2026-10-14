import { validateTerms } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { validateCharges } from '../chargesEditorModel';
import { fromTerms, toPlanFields } from './fromTerms';

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const FEE = { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' };
const LIFE = { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' };
const BASE = { kind: 'consumer', principalMinor: 10000000, openedOn: '2026-01-05', system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-02-05', rate: EA(24) };

// What a restructure does with the draft: the plan fields and the charges, over the terms in force.
const roundTrip = (terms) => {
  const draft = fromTerms(terms);
  const charges = validateCharges(draft.chargeRows);
  expect(charges.ok).toBe(true);
  return validateTerms({ ...terms, ...toPlanFields(draft), charges: charges.charges });
};

describe('fromTerms', () => {
  it('turns the terms in force into the strings the plan inputs hold', () => {
    const terms = validateTerms({ ...BASE, rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' }, charges: [FEE, LIFE] });

    const draft = fromTerms(terms);

    expect(draft).toMatchObject({
      rate: { value: '2', basis: 'effective', periodicity: 'monthly', timing: 'arrears' },
      system: 'french', periodicity: 'monthly', n: '36', firstDueOn: '2026-02-05', grace: { periods: '0', type: 'total' }, balloon: '', manualPlan: [],
    });
    expect(draft.chargeRows.map((row) => [row.id, row.value])).toEqual([['fee', '10000'], ['life', '0,05']]); // a percentage keeps its comma
  });

  it('keeps grace, a balloon and a manual plan as the wizard inputs show them', () => {
    const graced = fromTerms(validateTerms({ ...BASE, system: 'german', grace: { periods: 2, type: 'principal' } }));
    const balloon = fromTerms(validateTerms({ ...BASE, kind: 'leasing', system: 'interest_only', n: 12, balloonMinor: 4000000 }));
    const manual = fromTerms(validateTerms({ ...BASE, kind: 'other', system: 'manual', manualPlan: [['2026-02-05', 600000], ['2026-03-05', 500000]] }));

    expect(graced.grace).toEqual({ periods: '2', type: 'principal' });
    expect(balloon).toMatchObject({ system: 'interest_only', balloon: '4000000' });
    expect(manual).toMatchObject({ system: 'manual', n: '2', firstDueOn: '2026-02-05', manualPlan: [{ dueOn: '2026-02-05', amount: '600000' }, { dueOn: '2026-03-05', amount: '500000' }] });
  });
});

describe('fromTerms and toPlanFields round trip', () => {
  const cases = {
    'a French loan with a fee and a percentage insurance': { ...BASE, charges: [FEE, LIFE] },
    'a nominal monthly rate': { ...BASE, rate: { value: 2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' } },
    'a German loan with grace on the principal': { ...BASE, system: 'german', n: 24, grace: { periods: 3, type: 'principal' } },
    'an interest-only leasing with a balloon': { ...BASE, kind: 'leasing', system: 'interest_only', n: 12, balloonMinor: 4000000 },
    'a manual plan': { ...BASE, kind: 'other', system: 'manual', manualPlan: [['2026-02-05', 600000], ['2026-03-05', 500000]] },
    'a loan with a mora policy and a modality': { ...BASE, late: { mode: 'fixed', rate: EA(20), graceDays: 3 }, modality: 'consumer' },
  };

  for (const [name, input] of Object.entries(cases)) {
    it(`gives back the same valid terms for ${name}`, () => {
      const terms = validateTerms(input);

      expect(roundTrip(terms)).toEqual(terms);
    });
  }

  it('reads a blank number of installments as not a number, so the core rejects it instead of guessing', () => {
    const draft = { ...fromTerms(validateTerms(BASE)), n: '' };

    expect(toPlanFields(draft).n).toBeNaN();
    expect(() => validateTerms({ ...BASE, ...toPlanFields(draft) })).toThrow(expect.objectContaining({ code: 'invalid_terms' }));
  });

  it('drops grace and the balloon the chosen system does not support', () => {
    const draft = { ...fromTerms(validateTerms(BASE)), grace: { periods: '2', type: 'total' }, balloon: '500000' };

    expect(toPlanFields({ ...draft, system: 'french' })).toMatchObject({ grace: { periods: 2, type: 'total' } });
    expect(toPlanFields({ ...draft, system: 'french' })).not.toHaveProperty('balloonMinor');
    expect(toPlanFields({ ...draft, system: 'interest_only' })).toMatchObject({ balloonMinor: 500000 });
    expect(toPlanFields({ ...draft, system: 'interest_only' })).not.toHaveProperty('grace');
  });
});
