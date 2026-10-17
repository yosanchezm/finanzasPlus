// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { applyCorrection, buildCorrection } from '../../src/ledger/correction.js';
import { validateEvent } from '../../src/ledger/events.js';
import { previewChange } from '../../src/ledger/preview.js';
import { project } from '../../src/ledger/project.js';
import { validateTerms } from '../../src/terms.js';
import { EA, debt, ev, french } from '../helpers/loans.js';

// fix/card-opening-statement: a card registered on a day after its last statement is fixed with a terms_correction
// of `card.lastStatementOn` (it sets the opening date, which must be a statement date) and, optionally,
// `card.openingMinimumMinor`. The card then bills that statement as the opening one.

const OWNER = validateTerms({
  kind: 'card',
  principalMinor: 3_268_319,
  openedOn: '2026-10-16',
  rate: EA(26.5),
  system: 'none',
  periodicity: 'monthly',
  charges: [
    { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45_000 },
    { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 },
  ],
  card: { statementDay: 15, dueDay: 3 },
});
const card = () => debt(OWNER, 'card1');
const ON = '2026-10-16';
const eventOf = (draft, id = 'fix1') => ev('terms_correction', draft.effectiveOn, 0, { fields: draft.fields, previous: draft.previous, appliesTo: draft.appliesTo }, id);

const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return 'did not throw';
};

describe('correcting the last statement of a card', () => {
  it('builds a draft that moves the opening date and records the date it replaces', () => {
    const draft = buildCorrection(card(), [], { card: { lastStatementOn: '2026-10-15' } }, { on: ON });
    expect(draft).toEqual({
      kind: 'terms_correction',
      effectiveOn: ON,
      amountMinor: 0,
      fields: { card: { lastStatementOn: '2026-10-15' } },
      previous: { card: { lastStatementOn: '2026-10-16' } },
      appliesTo: 'opening',
    });
    const event = validateEvent({ id: 'c1', ...draft, payload: { fields: draft.fields, previous: draft.previous, appliesTo: draft.appliesTo } });
    expect(event.payload.fields).toEqual({ card: { lastStatementOn: '2026-10-15' } });
  });

  it('end to end: a card opened 2026-10-16 corrected to its 2026-10-15 statement owes that minimum on 2026-11-03', () => {
    const before = project(card(), [], ON);
    expect(before.nextDue).toBeNull();
    expect(before.card.nextDueOn).toBe('2026-12-03');

    const draft = buildCorrection(card(), [], { card: { lastStatementOn: '2026-10-15', openingMinimumMinor: 180_000 } }, { on: ON });
    expect(draft.previous).toEqual({ card: { lastStatementOn: '2026-10-16' } });
    const after = project(card(), [eventOf(draft)], ON);
    expect(after.terms.openedOn).toBe('2026-10-15');
    expect(after.nextDue).toMatchObject({ period: 1, statementOn: '2026-10-15', dueOn: '2026-11-03', status: 'due', minimumMinor: 180_000 });
    expect(after.plan[0]).toMatchObject({ opening: true, interestMinor: 0, chargesMinor: 0, taxesMinor: 0 });
    expect(after.card).toMatchObject({ nextStatementOn: '2026-11-15', minimumDueMinor: 180_000 });
    expect(after.corrections).toEqual([{ eventId: 'fix1', appliesTo: 'opening' }]);
  });

  it('previews the correction like any other one', () => {
    const draft = buildCorrection(card(), [], { card: { lastStatementOn: '2026-10-15' } }, { on: ON });
    const preview = previewChange(card(), [], draft, { on: ON });
    expect(preview.after).toMatchObject({ nextDueOn: '2026-11-03', nextTotalMinor: 163_416 });
    expect(preview.before).toMatchObject({ nextDueOn: null, nextTotalMinor: 0 });
    expect(preview.corrected).toEqual({ before: { card: { lastStatementOn: '2026-10-16' } }, after: { card: { lastStatementOn: '2026-10-15' } } });
  });

  it('refuses a date that is not a statement date of the card, or a statement after the recording date', () => {
    expect(failure(() => buildCorrection(card(), [], { card: { lastStatementOn: '2026-10-14' } }, { on: ON }))).toBe('not_a_statement_date');
    expect(failure(() => applyCorrection(OWNER, { card: { lastStatementOn: '2026-10-14' } }))).toBe('not_a_statement_date');
    expect(failure(() => buildCorrection(card(), [], { card: { lastStatementOn: '2026-11-15' } }, { on: ON }))).toBe('last_statement_in_future');
    expect(failure(() => buildCorrection(card(), [], { card: { lastStatementOn: '2026-02-30' } }, { on: ON }))).toBe('invalid_date');
  });

  it('checks the date against a statement day corrected in the same draft', () => {
    const draft = buildCorrection(card(), [], { card: { statementDay: 10, lastStatementOn: '2026-10-10' } }, { on: ON });
    expect(project(card(), [eventOf(draft)], ON).nextDue).toMatchObject({ statementOn: '2026-10-10', dueOn: '2026-11-03' });
    expect(failure(() => buildCorrection(card(), [], { card: { statementDay: 10, lastStatementOn: '2026-10-15' } }, { on: ON }))).toBe('not_a_statement_date');
  });

  it('corrects the opening minimum alone, never above the balance, and refuses it on a loan', () => {
    const opened = debt(validateTerms({ ...OWNER, openedOn: '2026-10-15' }), 'card1');
    const draft = buildCorrection(opened, [], { card: { openingMinimumMinor: 200_000 } }, { on: ON });
    expect(draft.fields).toEqual({ card: { openingMinimumMinor: 200_000 } });
    expect(project(opened, [eventOf(draft)], ON).nextDue.minimumMinor).toBe(200_000);
    expect(failure(() => buildCorrection(opened, [], { card: { openingMinimumMinor: 3_268_320 } }, { on: ON }))).toBe('invalid_card');
    expect(failure(() => buildCorrection(opened, [], { card: { openingMinimumMinor: -1 } }, { on: ON }))).toBe('invalid_card');
    expect(failure(() => buildCorrection(debt(french()), [], { card: { lastStatementOn: '2026-01-15' } }, { on: ON }))).toBe('correction_not_applicable');
  });

  it('does not check an unchanged opening date, so a form that carries every field still corrects the others', () => {
    const draft = buildCorrection(card(), [], { card: { statementDay: 20, lastStatementOn: '2026-10-16' } }, { on: ON });
    expect(draft.fields).toEqual({ card: { statementDay: 20 } });
  });

  it('refuses the same date as the one stored with no_change', () => {
    const opened = debt(validateTerms({ ...OWNER, openedOn: '2026-10-15' }), 'card1');
    expect(failure(() => buildCorrection(opened, [], { card: { lastStatementOn: '2026-10-15' } }, { on: ON }))).toBe('no_change');
  });
});
