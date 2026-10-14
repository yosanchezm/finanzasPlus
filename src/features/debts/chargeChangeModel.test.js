import { normalizeCharges, project } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { draftsFromCharges, patchDraft, removeDraft } from './chargesEditorModel';
import { chargesInForce, initialChargeForm, previewChargeChange } from './chargeChangeModel';
import { makeCard, makeDebt, makeEvent, makePayment } from './debtFixtures';

const FEE = { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' };
const IVA = { id: 'iva', kind: 'tax', label: 'IVA sobre la comisión', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment' };
const LIFE = { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' };

// 10,000,000 at 24% EA in 36 installments with a 10,000 fee and 19% IVA on it: installment 380,381 + 11,900 = 392,281.
const loan = (charges = [FEE, IVA]) => makeDebt({ principalMinor: 10000000 }, { principalMinor: 10000000, n: 36, charges });
const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 10000000);
const FIRST_PAID = makePayment('e1', '2026-02-05', 392281);

// Runs the preview as the dialog does: the projection as of today and a form that starts from the charges in force.
const run = ({ debt = loan(), events = [DISBURSEMENT, FIRST_PAID], today = '2026-02-20', effectiveOn = '2026-03-01', edit = (rows) => rows } = {}) => {
  const projection = project(debt, events, today);
  const form = initialChargeForm(projection, events, today);
  return previewChargeChange({ debt, events, projection, today, form: { ...form, effectiveOn, rows: edit(form.rows) } });
};
const setFee = (text) => (rows) => patchDraft(rows, 'fee', { value: text });

describe('initialChargeForm and chargesInForce', () => {
  it('starts from the charges in force as drafts, effective today', () => {
    const projection = project(loan(), [DISBURSEMENT], '2026-02-20');

    const form = initialChargeForm(projection, [DISBURSEMENT], '2026-02-20');

    expect(form.effectiveOn).toBe('2026-02-20');
    expect(form.rows).toEqual(draftsFromCharges(normalizeCharges([FEE, IVA])));
    expect(form.rows.map((row) => row.value)).toEqual(['10000', '19']);
  });

  it('follows a stored charge change of a loan, which the projection already applies', () => {
    const change = makeEvent('c1', 'charge_change', '2026-01-10', 0, { charges: normalizeCharges([{ ...FEE, value: 15000 }]) });
    const events = [DISBURSEMENT, change];

    expect(chargesInForce(project(loan(), events, '2026-02-20'), events, '2026-02-20').map((charge) => [charge.id, charge.value])).toEqual([['fee', 15000]]);
  });

  it('follows the active charge changes of a card, whose projection keeps the original terms, and skips voided and future ones', () => {
    const swap = (id, on, value) => ({ ...makeEvent(id, 'charge_change', on, 0, { charges: normalizeCharges([{ id: 'mgmt_fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value }]) }), debtId: 'c1' });
    const events = [
      swap('c1', '2026-04-20', 12000),
      swap('c2', '2026-05-01', 14000),
      { ...makeEvent('v1', 'void', '2026-05-02', 0, { targetEventId: 'c2', reason: 'x' }), debtId: 'c1' },
      swap('c3', '2026-08-01', 20000),
    ];
    const projection = project(makeCard(), events, '2026-05-20');

    expect(projection.terms.charges.map((charge) => charge.value)).toEqual([9000, 19]); // the card projection has not applied them
    expect(chargesInForce(projection, events, '2026-05-20').map((charge) => [charge.id, charge.value])).toEqual([['mgmt_fee', 12000]]);
  });
});

describe('previewChargeChange', () => {
  it('says nothing changes while the set is the one in force, and offers no draft', () => {
    const result = run();

    expect(result.same).toBe(true);
    expect(result.draft).toBeNull();
    expect(result.before).toBeNull();
  });

  it('previews a fee of 10,000 changed to 12,000 next month from that date only', () => {
    const result = run({ edit: setFee('12000') });

    expect(result.draft).toEqual({ kind: 'charge_change', effectiveOn: '2026-03-01', charges: normalizeCharges([{ ...FEE, value: 12000 }, IVA]) });
    expect(result.same).toBe(false);
    expect(result.backdated).toBe(false);
    // The next installment pays 12,000 + 19 % = 14,280 in charges instead of 11,900; 35 installments are left.
    expect(result.before.nextTotalMinor).toBe(392281);
    expect(result.after.nextTotalMinor).toBe(394661);
    expect(result.before.remainingChargesMinor).toBe(35 * 11900);
    expect(result.after.remainingChargesMinor).toBe(35 * 14280);
  });

  it('applies the new set only to the installments due after the effective date', () => {
    const result = run({ effectiveOn: '2026-06-01', edit: setFee('12000') });

    // Installments 2 to 4 (due Mar to May) keep the old fee; 5 to 36 pay the new one.
    expect(result.before.remainingChargesMinor).toBe(35 * 11900);
    expect(result.after.remainingChargesMinor).toBe(3 * 11900 + 32 * 14280);
    expect(result.after.nextDueOn).toBe('2026-06-05');
  });

  it('removing the fee takes its IVA with it: the next installment is the bare one and no charge is left to pay', () => {
    const result = run({ edit: (rows) => removeDraft(rows, 'fee') });

    expect(result.draft.charges).toEqual([]);
    expect(result.after.nextTotalMinor).toBe(380381);
    expect(result.after.remainingChargesMinor).toBe(0);
    expect(result.before.remainingChargesMinor).toBe(35 * 11900);
  });

  it('adds an insurance on the balance and shows the higher installment', () => {
    const result = run({ edit: (rows) => [...rows, ...draftsFromCharges(normalizeCharges([LIFE]))] });

    expect(result.draft.charges.map((charge) => charge.id)).toEqual(['fee', 'iva', 'life']);
    expect(result.after.nextTotalMinor).toBeGreaterThan(result.before.nextTotalMinor);
    expect(result.after.remainingChargesMinor).toBeGreaterThan(result.before.remainingChargesMinor);
  });

  it('flags a dangling reference and offers no draft or figures', () => {
    const result = run({ edit: (rows) => rows.filter((row) => row.id !== 'fee') });

    expect(result.check.ok).toBe(false);
    expect(result.check.issues).toEqual([{ id: 'iva', field: 'refId', message: '«IVA sobre la comisión» necesita un cargo anterior como base. Elige uno o quítalo.' }]);
    expect(result.draft).toBeNull();
    expect(result.after).toBeNull();
  });

  it('flags an invalid effective date but keeps the rows as they are', () => {
    const result = run({ effectiveOn: '', edit: setFee('12000') });

    expect(result.issue).toBe('Elige una fecha válida.');
    expect(result.draft).toBeNull();
  });

  it('lists the recorded payments whose cost a backdated change alters', () => {
    const result = run({ today: '2026-03-10', effectiveOn: '2026-01-20', edit: setFee('12000') });

    expect(result.backdated).toBe(true);
    // The 392,281 payment of 5 Feb now covers 12,000 + 2,280 of charges: 195,156 of cost instead of 192,776.
    expect(result.impacted).toEqual([{ eventId: 'e1', label: 'Pago del 5 feb', costBeforeMinor: 192776, costAfterMinor: 195156 }]);
  });

  it('still saves a change that moves no figure, such as a rename, and says so', () => {
    const result = run({ edit: (rows) => patchDraft(rows, 'fee', { label: 'Comisión de manejo' }) });

    expect(result.unchanged).toBe(true);
    expect(result.same).toBe(false);
    expect(result.draft.charges[0].label).toBe('Comisión de manejo');
  });

  it('refuses a set whose event would not fit the 8000-character payload', () => {
    const many = normalizeCharges(Array.from({ length: 60 }, (_, index) => ({ id: `c${index}`, kind: 'other', label: `Cargo número ${index} con un nombre largo`, basis: 'fixed', value: 1000 + index })));
    const result = run({ edit: () => draftsFromCharges(many) });

    expect(result.draft).toBeNull();
    expect(result.issue).toBe('Son demasiados cargos para guardarlos en un solo cambio. Quita algunos.');
    expect(run({ edit: () => draftsFromCharges(many.slice(0, 5)) }).draft.charges).toHaveLength(5);
  });

  it('compares the minimum payment of a card, with no remaining-periods or mode', () => {
    const events = [{ ...makePayment('p1', '2026-05-10', 100000), debtId: 'c1' }];
    const result = run({ debt: makeCard(), events, today: '2026-05-20', effectiveOn: '2026-05-01', edit: (rows) => patchDraft(rows, 'mgmt_fee', { value: '12000' }) });

    expect(result.isCard).toBe(true);
    expect(result.draft).toMatchObject({ kind: 'charge_change', effectiveOn: '2026-05-01' });
    expect(result.draft).not.toHaveProperty('mode');
    expect(result.before.nextTotalMinor).toBe(146102);
    expect(result.after.nextTotalMinor).toBe(149672);
  });

  it('starts a card from the card charges, not the loan ones', () => {
    const result = run({ debt: makeCard(), events: [], today: '2026-05-20', effectiveOn: '2026-05-20' });

    expect(result.same).toBe(true);
    expect(result.check.charges.map((charge) => charge.id)).toEqual(['mgmt_fee', 'mgmt_iva']);
  });
});
