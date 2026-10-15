import { project, resolveLegal } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { makeCard, makeDebt, makeEvent, makePayment } from './debtFixtures';
import { INSTALLMENT_TOO_LOW, initialRateForm, modesFor, previewRateChange, rateInForce } from './rateChangeModel';

const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 1000000);
const EA = (value) => ({ value: String(value), basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const MV = (value) => ({ value: String(value), basis: 'effective', periodicity: 'monthly', timing: 'arrears' });

// Runs the preview the way the dialog does: the projection as of today and a form that changes only what the test names.
const run = ({ debt = makeDebt(), events = [DISBURSEMENT], today = '2026-03-10', ...form } = {}) => {
  const projection = project(debt, events, today);
  return previewRateChange({ debt, events, projection, today, form: { effectiveOn: today, rate: EA(24), mode: 'keep_term', ...form } });
};

describe('rateInForce', () => {
  const rateChange = (id, on, value) => ({ ...makeEvent(id, 'rate_change', on, 0, { rate: { value, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' }), debtId: 'c1' });
  const voidOf = (id, targetEventId) => ({ ...makeEvent(id, 'void', '2026-05-02', 0, { targetEventId, reason: 'x' }), debtId: 'c1' });

  it('is the rate of the terms for a loan, whose projection already applies its changes', () => {
    const events = [DISBURSEMENT, makeEvent('r1', 'rate_change', '2026-02-01', 0, { rate: { value: 20, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' })];
    const projection = project(makeDebt(), events, '2026-03-10');

    expect(rateInForce(projection)).toEqual(projection.terms.rate);
    expect(rateInForce(projection).value).toBe(20);
  });

  it('follows the active rate changes of a card, whose projection keeps the original terms, and skips voided and future ones', () => {
    const events = [rateChange('r1', '2026-04-20', 24), rateChange('r2', '2026-05-01', 22), voidOf('v1', 'r2'), rateChange('r3', '2026-08-01', 18)];
    const projection = project(makeCard(), events, '2026-05-20');

    expect(projection.terms.rate.value).toBe(28); // the card projection has not applied them
    expect(rateInForce(projection).value).toBe(24);
  });

  it('falls back to the original rate when every rate change of the card is voided or still in the future', () => {
    const events = [rateChange('r1', '2026-04-20', 24), voidOf('v1', 'r1'), rateChange('r3', '2026-08-01', 18)];

    expect(rateInForce(project(makeCard(), events, '2026-05-20')).value).toBe(28);
    expect(rateInForce(project(makeCard(), [], '2026-05-20')).value).toBe(28);
  });
});

describe('initialRateForm', () => {
  it('starts from the rate in force, as the strings the inputs hold, effective today and keeping the term', () => {
    const projection = project(makeDebt(), [DISBURSEMENT], '2026-03-10');

    expect(initialRateForm(projection, '2026-03-10')).toEqual({ effectiveOn: '2026-03-10', rate: EA(24), mode: 'keep_term' });
  });

  it('starts a card from the rate its active rate change put in force, not from the original terms', () => {
    const events = [{ ...makeEvent('r1', 'rate_change', '2026-04-20', 0, { rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' }), debtId: 'c1' }];
    const projection = project(makeCard(), events, '2026-05-20');

    expect(initialRateForm(projection, '2026-05-20')).toEqual({ effectiveOn: '2026-05-20', rate: EA(24), mode: 'keep_term' });
  });

  it('keeps the convention of the current rate and starts an interest-free debt at 0', () => {
    const monthly = makeDebt({}, { rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' } });
    const free = makeDebt({}, { rate: { convention: 'ZERO' } });

    expect(initialRateForm(project(monthly, [DISBURSEMENT], '2026-03-10'), '2026-03-10').rate).toEqual(MV(2));
    expect(initialRateForm(project(free, [DISBURSEMENT], '2026-03-10'), '2026-03-10').rate).toEqual(EA(0));
  });
});

describe('modesFor', () => {
  const modes = (debt, events = [DISBURSEMENT]) => modesFor(project(debt, events, '2026-03-10'));

  it('offers keep_installment only to French loans', () => {
    expect(modes(makeDebt())).toEqual(['keep_term', 'keep_installment']);
    expect(modes(makeDebt({}, { system: 'german' }))).toEqual(['keep_term']);
    expect(modes(makeDebt({}, { system: 'interest_only', balloonMinor: 400000 }))).toEqual(['keep_term']);
  });

  it('offers no mode at all to a card', () => {
    expect(modes(makeCard(), [])).toEqual([]);
  });
});

describe('previewRateChange', () => {
  it('echoes 2% monthly as about 26.8% EA and previews the installment before and after', () => {
    const result = run({ today: '2026-01-20', effectiveOn: '2026-01-20', rate: MV(2) });

    expect(result.echo.ok).toBe(true);
    expect(result.echo.eaPercent).toBeCloseTo(26.82, 2);
    expect(result.issue).toBeNull();
    expect(result.draft).toEqual({ kind: 'rate_change', effectiveOn: '2026-01-20', rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' }, mode: 'keep_term' });
    expect(result.before.installmentMinor).toBe(93453);
    expect(result.after.installmentMinor).toBe(94560); // 1,000,000 at 2% a month over 12 installments
    expect(result.unchanged).toBe(false);
    expect(result.backdated).toBe(false);
  });

  it('keep_installment holds the installment and keep_term holds the term', () => {
    const base = { today: '2026-01-20', effectiveOn: '2026-01-20', rate: EA(20) };
    const installment = run({ ...base, mode: 'keep_installment' });
    const term = run({ ...base, mode: 'keep_term' });

    expect(installment.mode).toBe('keep_installment');
    expect(installment.draft.mode).toBe('keep_installment');
    expect(installment.after.installmentMinor).toBe(93453);
    expect(term.after.installmentMinor).toBe(91857);
    expect(term.after.remainingPeriods).toBe(12);
    expect(installment.after.remainingInterestMinor).toBeLessThan(term.after.remainingInterestMinor);
  });

  it('keeps the term on a system that has no keep_installment, whatever was asked', () => {
    const german = run({ debt: makeDebt({}, { system: 'german' }), rate: EA(20), mode: 'keep_installment' });

    expect(german.modes).toEqual(['keep_term']);
    expect(german.mode).toBe('keep_term');
    expect(german.tooLow).toBe(false);
    expect(german.draft.mode).toBe('keep_term');
  });

  it('falls back to keep_term when the installment no longer covers the new interest, and says so', () => {
    const result = run({ effectiveOn: '2026-03-01', rate: EA(400), mode: 'keep_installment' });

    expect(result.tooLow).toBe(true);
    expect(result.mode).toBe('keep_term');
    expect(result.draft.mode).toBe('keep_term');
    expect(result.issue).toBeNull();
    expect(result.after.installmentMinor).toBeGreaterThan(result.before.installmentMinor);
    expect(INSTALLMENT_TOO_LOW).toBe('Con la nueva tasa, la cuota actual ya no cubre los intereses o el plan pasaría de 2000 cuotas. Elegimos «Mantener el plazo» para recalcular la cuota.');
  });

  it('does not report a too-low installment when keep_term was the choice or the installment still covers the interest', () => {
    expect(run({ effectiveOn: '2026-03-01', rate: EA(400), mode: 'keep_term' }).tooLow).toBe(false);
    expect(run({ effectiveOn: '2026-03-01', rate: EA(30), mode: 'keep_installment' }).tooLow).toBe(false);
  });

  it('lists the payments a backdated change would re-cost', () => {
    const events = [DISBURSEMENT, makePayment('e1', '2026-02-05')];
    const result = run({ events, today: '2026-03-10', effectiveOn: '2026-01-20', rate: EA(30) });

    expect(result.backdated).toBe(true);
    expect(result.impacted).toEqual([{ eventId: 'e1', label: 'Pago del 5 feb', costBeforeMinor: 18088, costAfterMinor: 22104 }]);
  });

  it('is backdated but lists nothing when the change starts after the recorded payments', () => {
    const events = [DISBURSEMENT, makePayment('e1', '2026-02-05')];
    const result = run({ events, today: '2026-03-10', effectiveOn: '2026-03-01', rate: EA(30) });

    expect(result.backdated).toBe(true);
    expect(result.impacted).toEqual([]);
  });

  it('flags a change that leaves every installment as it was', () => {
    const afterTheLastDue = run({ effectiveOn: '2027-06-01', rate: MV(2) });

    expect(afterTheLastDue.unchanged).toBe(true);
    expect(afterTheLastDue.draft).not.toBeNull();
    expect(run({ effectiveOn: '2026-03-10', rate: MV(2) }).unchanged).toBe(false);
  });

  it('produces no draft and no issue while the rate is not a valid number yet', () => {
    for (const value of ['', '-5', 'abc']) {
      const result = run({ rate: EA(value) });
      expect(result.echo.ok).toBe(false);
      expect(result.draft).toBeNull();
      expect(result.before).toBeNull();
      expect(result.issue).toBeNull();
    }
    expect(run({ rate: EA(22) }).draft).not.toBeNull();
  });

  it('asks for a real date', () => {
    const result = run({ effectiveOn: '2026-02-30', rate: EA(22) });

    expect(result.issue).toBe('Elige una fecha válida.');
    expect(result.draft).toBeNull();
  });

  it('cites the household usury cap in force on the effective date, without blocking', () => {
    const legal = resolveLegal([{ kind: 'usury', modality: 'consumer', validFrom: '2026-03-01', validTo: '2026-03-31', value: 2900, source: 'Resolución', verified: true }]);
    const debt = makeDebt({ legal });
    const above = run({ debt, rate: EA(29.5) });
    const below = run({ debt, rate: EA(24) });

    expect(above.echo.notice).toMatchObject({ code: 'usury_above_cap', capEA: 29 });
    expect(above.draft).not.toBeNull();
    expect(below.echo.notice).toBeNull();
  });

  it('previews a card without a mode and compares its next payment', () => {
    const events = [{ ...makeEvent('p1', 'payment', '2026-05-10', 100000), debtId: 'c1' }];
    const result = run({ debt: makeCard(), events, today: '2026-05-20', effectiveOn: '2026-05-01', rate: EA(35) });

    expect(result.isCard).toBe(true);
    expect(result.modes).toEqual([]);
    expect(result.mode).toBe('keep_term');
    expect(result.draft).toMatchObject({ kind: 'rate_change', mode: 'keep_term', rate: { value: 35 } });
    expect(result.before.installmentMinor).toBe(110392); // the next minimum payment, due 30 May
    expect(result.after.installmentMinor).toBe(112662);
  });
});
