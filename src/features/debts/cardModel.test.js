// @vitest-environment node
import { project } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { previewCharge, previewStatement } from './cardModel';
import { makeCard } from './debtFixtures';

const TODAY = '2026-04-20';
const debt = makeCard();
const base = { debt, events: [], actorId: 'u1', today: TODAY, effectiveOn: '2026-04-15' };
const COMPUTED = 1_721_102; // opening 1,700,000 plus the first statement's interest, fee and IVA

describe('previewStatement', () => {
  it('compares the stated balance with the computed one and writes it as an adjustment', () => {
    const result = previewStatement({ ...base, balance: String(COMPUTED + 350), minimum: '150000' });

    expect(result.draft).toEqual({ kind: 'adjustment', effectiveOn: '2026-04-15', balanceMinor: COMPUTED + 350, minimumDueMinor: 150000, note: 'Extracto' });
    expect(result.preview).toEqual({ computedMinor: COMPUTED, driftMinor: 350, balanceAfterMinor: COMPUTED + 350 });
  });

  it('leaves the minimum to the card rule when it is not typed, and shows a lower balance as a negative difference', () => {
    const result = previewStatement({ ...base, balance: '1700000', minimum: '' });

    expect(result.draft).not.toHaveProperty('minimumDueMinor');
    expect(result.preview.driftMinor).toBe(1_700_000 - COMPUTED);
  });

  it.each([
    ['an empty balance', { balance: '' }, null],
    ['a negative balance', { balance: '-5' }, 'Escribe el saldo total del extracto'],
    ['a balance with decimals', { balance: '1000.5' }, 'Escribe el saldo total del extracto'],
    ['a minimum that is not a number', { balance: '900000', minimum: 'abc' }, 'Escribe el pago mínimo'],
    ['a bad date', { balance: '900000', effectiveOn: '2026-13-40' }, 'Elige una fecha válida'],
  ])('gives no draft for %s', (_label, patch, issue) => {
    const result = previewStatement({ ...base, minimum: '', ...patch });

    expect(result.draft).toBeNull();
    expect(result.preview).toBeNull();
    if (issue) expect(result.issue).toContain(issue);
    else expect(result.issue).toBeNull();
  });
});

describe('previewCharge', () => {
  const charge = (patch) => previewCharge({ ...base, effectiveOn: '2026-04-20', type: 'revolving', label: '', amount: '80000', n: '', rate: '', ...patch });
  const before = project(debt, [], '2026-04-20').balanceMinor;

  it('records a purchase of the month on the revolving balance, with a default description', () => {
    const result = charge({});

    expect(result.draft).toEqual({ kind: 'charge', effectiveOn: '2026-04-20', amountMinor: 80000, trancheType: 'revolving', label: 'Compra' });
    expect(result.preview).toEqual({ balanceAfterMinor: before + 80000 });
  });

  it('opens an installment purchase with its own count and rate, using the card rate when the rate is blank', () => {
    expect(charge({ type: 'deferred', label: ' Portátil ', n: '6', rate: '12' }).draft).toEqual({
      kind: 'charge', effectiveOn: '2026-04-20', amountMinor: 80000, trancheType: 'deferred', label: 'Portátil', n: 6, rate: { convention: 'EA', value: 12 },
    });
    expect(charge({ type: 'deferred', n: '3', rate: '' }).draft).not.toHaveProperty('rate');
    expect(charge({ type: 'deferred', n: '1' }).issue).toContain('al menos 2 cuotas');
  });

  it('accrues a cash advance from its date, with an optional rate', () => {
    expect(charge({ type: 'advance', rate: '' }).draft).toMatchObject({ trancheType: 'advance', label: 'Avance en efectivo' });
    expect(charge({ type: 'advance', rate: '35' }).draft.rate).toEqual({ convention: 'EA', value: 35 });
  });

  it.each([['an empty amount', { amount: '' }, null], ['a zero amount', { amount: '0' }, 'Escribe el valor'], ['a negative rate', { type: 'advance', rate: '-3' }, 'La tasa']])('gives no draft for %s', (_label, patch, issue) => {
    const result = charge(patch);

    expect(result.draft).toBeNull();
    if (issue) expect(result.issue).toContain(issue);
    else expect(result.issue).toBeNull();
  });
});

describe('previewStatement: the mora of the statement', () => {
  it('writes the stated mora next to the balance and keeps the stated balance as the truth', () => {
    const result = previewStatement({ ...base, balance: String(COMPUTED), minimum: '', lateInterest: '900' });

    expect(result.draft).toEqual({ kind: 'adjustment', effectiveOn: '2026-04-15', balanceMinor: COMPUTED, lateInterestMinor: 900, note: 'Extracto' });
    expect(result.preview.balanceAfterMinor).toBe(COMPUTED);
  });

  it('leaves the mora out when it is blank or not given', () => {
    expect(previewStatement({ ...base, balance: String(COMPUTED), minimum: '', lateInterest: '' }).draft).not.toHaveProperty('lateInterestMinor');
    expect(previewStatement({ ...base, balance: String(COMPUTED), minimum: '' }).draft).not.toHaveProperty('lateInterestMinor');
    expect(previewStatement({ ...base, balance: String(COMPUTED), minimum: '', lateInterest: '0' }).draft.lateInterestMinor).toBe(0);
  });

  it.each(['abc', '-5', '10.5'])('gives no draft for the mora %s', (lateInterest) => {
    const result = previewStatement({ ...base, balance: String(COMPUTED), minimum: '', lateInterest });

    expect(result.draft).toBeNull();
    expect(result.issue).toContain('Escribe la mora del extracto');
  });
});
