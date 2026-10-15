// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { planCommit } from '../../src/ledger/commit.js';
import { activeEvents, sortEvents, validateEvent } from '../../src/ledger/events.js';
import { project } from '../../src/ledger/project.js';

// Forward compatibility (DL1, AD1): readers skip event kinds this bundle does not know,
// so a debt written by a newer build stays readable. Writers stay strict.

const cardTerms = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8')).terms;

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const loanTerms = {
  kind: 'consumer',
  principalMinor: 10_000_000,
  openedOn: '2026-01-15',
  rate: EA(24),
  system: 'french',
  periodicity: 'monthly',
  n: 36,
  firstDueOn: '2026-02-15',
};
const debt = (terms = loanTerms) => ({ $id: 'd1', householdId: 'h1', name: 'Credito', ownerScope: 'shared', terms });
const stored = (kind, effectiveOn, amountMinor, payload, id) => ({
  $id: id,
  debtId: 'd1',
  kind,
  effectiveOn,
  amountMinor,
  payloadJson: JSON.stringify(payload),
  $createdAt: '2026-01-01T00:00:00.000Z',
});
const pay = (effectiveOn, amountMinor, id) => stored('payment', effectiveOn, amountMinor, {}, id);
const futureAt = (effectiveOn, id = 'lp1') => stored('mora_schedule', effectiveOn, 0, { late: { mode: 'usury' } }, id);
const code = (fn) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return 'no error';
};
const withoutNotices = ({ notices, ...rest }) => rest;

describe('project with an unknown event kind', () => {
  const known = [pay('2026-02-15', 390_381, 'p1'), pay('2026-03-16', 100_000, 'p2')];

  it('returns the projection of the known events and adds one unknown_event_kind notice with id and kind', () => {
    const baseline = project(debt(), known, '2026-04-20');
    const projection = project(debt(), [known[0], futureAt('2026-03-01'), known[1]], '2026-04-20');
    expect(projection.notices).toEqual([{ code: 'unknown_event_kind', eventId: 'lp1', kind: 'mora_schedule' }]);
    expect(withoutNotices(projection)).toEqual(withoutNotices(baseline));
    expect(projection.applied.map((entry) => entry.eventId)).toEqual(['p1', 'p2']);
    expect(projection.pastDueMinor).toBeGreaterThan(0);
  });

  it('adds one notice per skipped event and keeps the other notices', () => {
    const overpay = pay('2026-02-15', 20_000_000, 'big');
    const projection = project(debt(), [overpay, futureAt('2026-03-01', 'a'), stored('mystery', '2026-03-02', 0, {}, 'b')], '2026-04-20');
    expect(projection.notices.map((notice) => notice.code)).toEqual(['surplus', 'unknown_event_kind', 'unknown_event_kind']);
    expect(projection.notices.filter((notice) => notice.code === 'unknown_event_kind').map((notice) => [notice.eventId, notice.kind])).toEqual([
      ['a', 'mora_schedule'],
      ['b', 'mystery'],
    ]);
  });

  it('flags an unknown event dated after asOf too, because it will matter once its date arrives', () => {
    const projection = project(debt(), known, '2026-03-20');
    const withFuture = project(debt(), [...known, futureAt('2026-12-01')], '2026-03-20');
    expect(projection.notices).toEqual([]);
    expect(withFuture.notices).toEqual([{ code: 'unknown_event_kind', eventId: 'lp1', kind: 'mora_schedule' }]);
    expect(withoutNotices(withFuture)).toEqual(withoutNotices(projection));
  });

  it('ignores a void whose target is an unknown event, without error', () => {
    const baseline = project(debt(), known, '2026-04-20');
    const voidUnknown = stored('void', '2026-03-05', 0, { targetEventId: 'lp1', reason: 'oops' }, 'v1');
    const projection = project(debt(), [...known, futureAt('2026-03-01'), voidUnknown], '2026-04-20');
    expect(withoutNotices(projection)).toEqual(withoutNotices(baseline));
    expect(projection.applied.map((entry) => entry.eventId)).toEqual(['p1', 'p2']);
  });

  it('still applies a void that targets a known event next to an unknown one', () => {
    const voidKnown = stored('void', '2026-03-17', 0, { targetEventId: 'p2' }, 'v2');
    const projection = project(debt(), [...known, futureAt('2026-03-01'), voidKnown], '2026-04-20');
    expect(projection.applied.map((entry) => entry.eventId)).toEqual(['p1']);
    expect(projection.notices).toHaveLength(1);
  });

  it('also covers the card projector', () => {
    const cardEvents = [stored('payment', '2026-03-10', 50_000, {}, 'c1')];
    const baseline = project(debt(cardTerms), cardEvents, '2026-04-20');
    const projection = project(debt(cardTerms), [...cardEvents, futureAt('2026-03-12')], '2026-04-20');
    expect(projection.notices).toEqual([...baseline.notices, { code: 'unknown_event_kind', eventId: 'lp1', kind: 'mora_schedule' }]);
    expect(withoutNotices(projection)).toEqual(withoutNotices(baseline));
  });

  it('still throws on a malformed event: only a string kind outside the list is tolerated', () => {
    expect(code(() => project(debt(), [{ ...pay('2026-02-15', 1000, 'x'), kind: undefined }], '2026-04-20'))).toBe('invalid_event');
    expect(code(() => project(debt(), [{ ...pay('2026-02-15', 1000, 'x'), kind: 7 }], '2026-04-20'))).toBe('invalid_event');
    expect(code(() => project(debt(), [pay('2026-02-15', -5, 'x')], '2026-04-20'))).toBe('invalid_event');
    expect(code(() => project(debt(), ['not an event'], '2026-04-20'))).toBe('invalid_event');
  });
});

describe('sortEvents and activeEvents with an unknown event kind', () => {
  const events = [pay('2026-03-16', 100_000, 'p2'), futureAt('2026-03-01'), pay('2026-02-15', 390_381, 'p1')];

  it('sortEvents drops the unknown event and orders the known ones', () => {
    expect(sortEvents(events).map((entry) => entry.id)).toEqual(['p1', 'p2']);
  });

  it('activeEvents drops the unknown event, voids of it, and keeps the rest', () => {
    const voidUnknown = stored('void', '2026-03-05', 0, { targetEventId: 'lp1' }, 'v1');
    expect(activeEvents([...events, voidUnknown]).map((entry) => entry.id)).toEqual(['p2', 'p1']);
  });

  it('still throws for a corrupt known event', () => {
    expect(code(() => sortEvents([pay('2026-02-15', 0, 'zero')]))).toBe('invalid_event');
    expect(code(() => activeEvents([{ id: '', kind: 'payment' }]))).toBe('invalid_event');
  });
});

describe('writes stay strict', () => {
  it('validateEvent rejects an unknown kind (a lenient validator must fail this)', () => {
    expect(code(() => validateEvent(futureAt('2026-03-01')))).toBe('invalid_event');
    expect(code(() => validateEvent(stored('mystery', '2026-03-01', 0, {}, 'm1')))).toBe('invalid_event');
  });

  it('planCommit refuses a draft of an unknown kind and writes nothing', () => {
    const draft = { kind: 'mora_schedule', effectiveOn: '2026-03-01', amountMinor: 0, payload: { late: { mode: 'usury' } } };
    const ctx = { eventId: 'ev1', dedupeKey: 'web:n1', actorId: 'u1', source: 'web' };
    expect(code(() => planCommit(debt(), [], draft, ctx))).toBe('invalid_event');
  });

  it('planCommit cannot void an unknown event: it is not an active event for this bundle', () => {
    const draft = { kind: 'void', effectiveOn: '2026-03-05', amountMinor: 0, payload: { targetEventId: 'lp1' } };
    const ctx = { eventId: 'ev2', dedupeKey: 'web:n2', actorId: 'u1', source: 'web' };
    expect(() => planCommit(debt(), [futureAt('2026-03-01')], draft, ctx)).toThrow(ValidationError);
  });
});

// DL5: the web and Nia are released together, so no stale bundle should read uncorrected terms. A bundle from before
// S4 reads the correction as an event of an unknown kind. The doMock below makes the reader of this build do the same.
describe('a bundle that does not know terms_correction', () => {
  afterEach(() => {
    vi.doUnmock('../../src/ledger/events.js');
    vi.resetModules();
  });

  async function oldBundleProject() {
    vi.resetModules();
    vi.doMock('../../src/ledger/events.js', async (importOriginal) => {
      const actual = await importOriginal();
      const hide = (events) => events.map((event) => (event?.kind === 'terms_correction' ? { ...event, kind: 'terms_correction_unknown_here' } : event));
      return {
        ...actual,
        readEvents: (events) => {
          const { known, unknown } = actual.readEvents(hide(events));
          return { known, unknown: unknown.map((entry) => (entry.kind === 'terms_correction_unknown_here' ? { ...entry, kind: 'terms_correction' } : entry)) };
        },
      };
    });
    return (await import('../../src/ledger/project.js')).project;
  }

  const correction = (payload) => stored('terms_correction', '2026-06-10', 0, { previous: {}, appliesTo: 'opening', ...payload }, 'c1');

  it('projects a loan on its original terms with one unknown_event_kind notice, and a void of the correction changes nothing', async () => {
    const oldProject = await oldBundleProject();
    const known = [pay('2026-02-15', 390_381, 'p1')];
    const baseline = oldProject(debt(), known, '2026-07-01');
    const fix = correction({ fields: { rate: { ...EA(18) } } });
    const projection = oldProject(debt(), [...known, fix], '2026-07-01');
    expect(projection.notices).toEqual([{ code: 'unknown_event_kind', eventId: 'c1', kind: 'terms_correction' }]);
    expect(withoutNotices(projection)).toEqual(withoutNotices(baseline));
    expect(projection.terms.rate).toEqual(EA(24));
    expect(projection).not.toHaveProperty('corrections');
    const voided = oldProject(debt(), [...known, fix, stored('void', '2026-06-20', 0, { targetEventId: 'c1' }, 'v1')], '2026-07-01');
    expect(voided.notices).toEqual(projection.notices);
    expect(withoutNotices(voided)).toEqual(withoutNotices(baseline));
  });

  it('does the same for a card, whose statement day stays the original one', async () => {
    const oldProject = await oldBundleProject();
    const projection = oldProject(debt(cardTerms), [correction({ fields: { card: { statementDay: 20 } } })], '2026-07-01');
    expect(projection.card.statementDay).toBe(15);
    expect(projection.notices).toEqual([{ code: 'unknown_event_kind', eventId: 'c1', kind: 'terms_correction' }]);
  });

  it('is the build that knows the kind that applies the very same rows', () => {
    const fix = correction({ fields: { card: { statementDay: 20 } } });
    const projection = project(debt(cardTerms), [fix], '2026-07-01');
    expect(projection.card.statementDay).toBe(20);
    expect(projection.notices).toEqual([]);
  });
});
