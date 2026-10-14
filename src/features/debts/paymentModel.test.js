// @vitest-environment node
import { project } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { DAY_10, MORA_DISBURSEMENT, makeBigLoan, makeDebt, makeEvent, makeMoraLoan, makePayment } from './debtFixtures';
import { describeCoreError, dueNow, previewPayment } from './paymentModel';

const TODAY = '2026-02-05';
const preview = (overrides = {}, debt = makeBigLoan(), events = []) => previewPayment({
  debt, events, projection: project(debt, events, TODAY), actorId: 'u1', today: TODAY, amount: '390381', effectiveOn: TODAY, strategy: null, ...overrides,
});

describe('previewPayment', () => {
  it('splits the installment the way the commit will: principal 199,505, cost 190,876', () => {
    const result = preview();

    expect(result.issue).toBeNull();
    expect(result.draft).toEqual({ kind: 'payment', effectiveOn: TODAY, amountMinor: 390381 });
    expect(result.preview).toMatchObject({ principalMinor: 199505, interestMinor: 180876, feesMinor: 10000, costMinor: 190876, surplusMinor: 0, balanceAfterMinor: 9800495 });
    expect(result.dueMinor).toBe(390381);
  });

  it('turns an amount above what is due into an extra payment that needs a strategy', () => {
    const pending = preview({ amount: '2000000' });
    expect(pending).toMatchObject({ requiresStrategy: true, draft: null, preview: null, issue: 'Elige cómo aplicar el abono extra.' });

    const chosen = preview({ amount: '2000000', strategy: 'reduce_term' });
    expect(chosen.draft).toEqual({ kind: 'extra_payment', effectiveOn: TODAY, amountMinor: 2000000, strategy: 'reduce_term' });
    expect(chosen.preview.principalMinor).toBe(2000000 - 190876); // what is due first, then the rest to principal
    expect(chosen.preview.costMinor).toBe(190876);
  });

  it('accepts any amount on a balance-only debt without asking for a strategy', () => {
    const informal = makeDebt({}, { system: 'none', n: undefined, firstDueOn: undefined, periodicity: undefined, rate: { convention: 'ZERO' } });
    const events = [makeEvent('e0', 'disbursement', '2026-01-05', 1000000)];

    const result = preview({ amount: '250000' }, informal, events);

    expect(result.requiresStrategy).toBe(false);
    expect(result.draft).toMatchObject({ kind: 'payment', amountMinor: 250000 });
    expect(result.preview.balanceAfterMinor).toBe(750000);
  });

  it('rejects a bad amount or date with a message, and stays quiet while the amount is empty', () => {
    expect(preview({ amount: '0' }).issue).toBe('Escribe un monto en pesos mayor a 0.');
    expect(preview({ amount: '1500.5' }).issue).toBe('Escribe un monto en pesos mayor a 0.');
    expect(preview({ effectiveOn: '2026-13-40' }).issue).toBe('Elige una fecha válida.');
    expect(preview({ amount: '' })).toMatchObject({ issue: null, draft: null });
  });

  it('counts the whole overdue amount as due', () => {
    const debt = makeDebt();
    const projection = project(debt, [makePayment('e1', '2026-02-05')], '2026-04-10');
    expect(dueNow(projection)).toBe(93453 * 3); // installments 2 and 3 are overdue, 4 is the next due
  });
});

describe('describeCoreError', () => {
  it('translates the core validation codes users can reach', () => {
    expect(describeCoreError({ code: 'installment_too_low' })).toMatch(/no alcanza a cubrir los intereses/);
    expect(describeCoreError({ code: 'manual_plan_below_interest' })).toMatch(/plan manual/);
    expect(describeCoreError({ code: 'something_else' })).toBe('No se pudo calcular con esos datos. Revisa el monto y la fecha.');
  });
});

describe('previewPayment with mora', () => {
  const lateOn = (late) => makeMoraLoan({ late });

  it('shows the mora apart from charges and taxes: 390,381 paid on day 10 is 10,000 / 1,375 / 180,876 / 198,130 with cost 192,251', () => {
    const { preview: split, issue } = previewPayment({
      debt: lateOn(), events: [MORA_DISBURSEMENT], projection: project(lateOn(), [MORA_DISBURSEMENT], DAY_10), actorId: 'u1', today: DAY_10, amount: '390381', effectiveOn: DAY_10, strategy: null,
    });

    expect(issue).toBeNull();
    expect(split).toMatchObject({ feesMinor: 10000, lateMinor: 1375, interestMinor: 180876, principalMinor: 198130, costMinor: 192251 });
  });

  it('counts the mora in what is due now: the overdue row with mora (391,756) plus the next installment (390,381)', () => {
    expect(dueNow(project(lateOn(), [MORA_DISBURSEMENT], DAY_10))).toBe(391756 + 390381);
    expect(dueNow(project(lateOn(null), [MORA_DISBURSEMENT], DAY_10))).toBe(390381 + 390381);
  });

  it('has no mora line without a policy: the same payment is 199,505 of principal and cost 190,876', () => {
    const debt = lateOn(null);
    const { preview: split } = previewPayment({
      debt, events: [MORA_DISBURSEMENT], projection: project(debt, [MORA_DISBURSEMENT], DAY_10), actorId: 'u1', today: DAY_10, amount: '390381', effectiveOn: DAY_10, strategy: null,
    });

    expect(split).toMatchObject({ feesMinor: 10000, lateMinor: 0, interestMinor: 180876, principalMinor: 199505, costMinor: 190876 });
  });
});
