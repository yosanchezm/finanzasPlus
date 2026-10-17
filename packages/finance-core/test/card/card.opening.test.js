// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lastStatementOn } from '../../src/card/card.js';
import { ValidationError } from '../../src/errors.js';
import { project } from '../../src/ledger/project.js';
import { parseTerms, serializeTerms, validateTerms } from '../../src/terms.js';

// Opening statement (fix/card-opening-statement): a card registered on one of its statement dates starts from the
// bank statement the user copied. That cycle bills nothing new (its interest, fees and IVA are inside the balance),
// asks the stated or rule minimum over the opening balance and is due on the usual due date.

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const OWNER = {
  kind: 'card',
  principalMinor: 3_268_319,
  openedOn: '2026-10-15',
  rate: EA(26.5),
  system: 'none',
  periodicity: 'monthly',
  charges: [
    { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45_000 },
    { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 },
  ],
  card: { statementDay: 15, dueDay: 3 },
};
const owner = (overrides = {}, card = {}) => ({ ...OWNER, ...overrides, card: { ...OWNER.card, ...card } });
const debt = (t = owner()) => ({ $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: t });
const pay = (on, amountMinor, id) => ({ $id: id, debtId: 'card1', kind: 'payment', effectiveOn: on, amountMinor, payloadJson: '{}', $createdAt: '2026-01-01T00:00:00.000Z' });
const row = (projection, period) => projection.plan.find((entry) => entry.period === period);

describe('lastStatementOn', () => {
  it('is the statement of the same month when it is on or before the date, otherwise the previous one', () => {
    expect(lastStatementOn(15, '2026-10-16')).toBe('2026-10-15');
    expect(lastStatementOn(15, '2026-10-15')).toBe('2026-10-15');
    expect(lastStatementOn(15, '2026-10-14')).toBe('2026-09-15');
    expect(lastStatementOn(25, '2026-01-10')).toBe('2025-12-25');
  });

  it('clamps statement days beyond the month end', () => {
    expect(lastStatementOn(31, '2026-02-28')).toBe('2026-02-28');
    expect(lastStatementOn(31, '2026-03-30')).toBe('2026-02-28');
    expect(lastStatementOn(30, '2026-03-01')).toBe('2026-02-28');
    expect(lastStatementOn(31, '2028-03-15')).toBe('2028-02-29');
  });

  it('rejects a bad day or date', () => {
    expect(() => lastStatementOn(0, '2026-10-16')).toThrow(ValidationError);
    expect(() => lastStatementOn(15, '2026-02-30')).toThrow(ValidationError);
  });
});

describe('openingMinimumMinor in the card terms', () => {
  it('is optional, whole pesos and not above the opening balance', () => {
    expect(validateTerms(owner()).card).not.toHaveProperty('openingMinimumMinor');
    expect(validateTerms(owner({}, { openingMinimumMinor: 180_000 })).card.openingMinimumMinor).toBe(180_000);
    expect(validateTerms(owner({}, { openingMinimumMinor: 0 })).card.openingMinimumMinor).toBe(0);
    expect(() => validateTerms(owner({}, { openingMinimumMinor: 3_268_320 }))).toThrow(ValidationError);
    expect(() => validateTerms(owner({}, { openingMinimumMinor: -1 }))).toThrow(ValidationError);
    expect(() => validateTerms(owner({}, { openingMinimumMinor: 10.5 }))).toThrow(ValidationError);
  });

  it('round-trips through serializeTerms', () => {
    const terms = owner({}, { openingMinimumMinor: 180_000 });
    expect(parseTerms(serializeTerms(terms))).toEqual(validateTerms(terms));
    expect(serializeTerms(owner())).not.toContain('openingMinimumMinor');
  });
});

describe('a card opened on its statement date', () => {
  it('golden: the copied statement is due on its due date with a minimum and no new interest or charges', () => {
    const projection = project(debt(), [], '2026-10-16');
    const first = row(projection, 1);
    expect(first).toMatchObject({
      statementOn: '2026-10-15',
      dueOn: '2026-11-03',
      status: 'due',
      opening: true,
      interestMinor: 0,
      chargesMinor: 0,
      taxesMinor: 0,
      principalMinor: 0,
      lateInterestMinor: 0,
      charges: [],
      payInFullMinor: 3_268_319,
      closingMinor: 3_268_319,
    });
    expect(first.minimumMinor).toBe(163_416); // 5% of the balance, the default rule
    expect(projection.nextDue).toMatchObject({ period: 1, dueOn: '2026-11-03', status: 'due', outstandingMinor: 163_416 });
    expect(projection.balanceMinor).toBe(3_268_319);
    expect(projection.card).toMatchObject({ nextStatementOn: '2026-11-15', nextDueOn: '2026-12-03', minimumDueMinor: 163_416, payInFullMinor: 3_268_319 });
  });

  it('asks the stated opening minimum when there is one', () => {
    const projection = project(debt(owner({}, { openingMinimumMinor: 180_000 })), [], '2026-10-16');
    expect(row(projection, 1).minimumMinor).toBe(180_000);
    expect(projection.card.minimumDueMinor).toBe(180_000);
  });

  it('a payment before the due date covers it', () => {
    const projection = project(debt(), [pay('2026-11-02', 163_416, 'p1')], '2026-11-05');
    expect(row(projection, 1)).toMatchObject({ status: 'paid', paidMinor: 163_416 });
    expect(projection.pastDueMinor).toBe(0);
  });

  it('is past due after its due date when unpaid, like any other statement', () => {
    const projection = project(debt(), [], '2026-11-10');
    expect(row(projection, 1).status).toBe('pastDue');
    expect(projection.pastDueMinor).toBe(163_416);
  });

  it('the next statement bills interest on what was unpaid on the due date, plus the fee and IVA', () => {
    const unpaid = row(project(debt(), [], '2026-11-20'), 2);
    expect(unpaid).toMatchObject({ statementOn: '2026-11-15', dueOn: '2026-12-03', chargesMinor: 45_000, taxesMinor: 8_550 });
    expect(unpaid.interestMinor).toBeGreaterThan(0);
    const paidInFull = row(project(debt(), [pay('2026-11-03', 3_268_319, 'full')], '2026-11-20'), 2);
    expect(paidInFull.interestMinor).toBe(0);
    expect(paidInFull.chargesMinor).toBe(45_000);
  });

  it('opening installment purchases bill their first installment at the next statement', () => {
    const purchase = { id: 'tv', label: 'TV', principalMinor: 1_200_000, n: 12, rate: EA(0) };
    const projection = project(debt(owner({}, { deferred: [purchase] })), [], '2026-11-20');
    expect(row(projection, 1).principalMinor).toBe(0);
    expect(row(projection, 2).principalMinor).toBe(100_000);
  });

  it('recognises a clamped statement date at the month end', () => {
    const projection = project(debt(owner({ openedOn: '2026-02-28' }, { statementDay: 31, dueDay: 10 })), [], '2026-03-01');
    expect(row(projection, 1)).toMatchObject({ statementOn: '2026-02-28', dueOn: '2026-03-10', opening: true, interestMinor: 0, chargesMinor: 0 });
  });

  it('marks no opening statement when the card is opened on another day', () => {
    const projection = project(debt(owner({ openedOn: '2026-10-16' })), [], '2026-11-20');
    expect(row(projection, 1)).not.toHaveProperty('opening');
    expect(row(projection, 1).statementOn).toBe('2026-11-15');
  });
});
