// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { EVENT_KINDS, activeEvents, sortEvents, validateEvent } from '../../src/ledger/events.js';
import { mulberry32 } from '../helpers/prng.js';

const event = (overrides = {}) => ({
  $id: 'e1',
  debtId: 'd1',
  kind: 'payment',
  effectiveOn: '2026-03-15',
  amountMinor: 380_381,
  payloadJson: '{}',
  actorId: 'u1',
  source: 'web',
  dedupeKey: 'web:n1',
  $createdAt: '2026-03-15T10:00:00.000Z',
  ...overrides,
});

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const code = (fn) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return 'no error';
};

describe('EVENT_KINDS', () => {
  it('lists the ten append-only kinds', () => {
    expect([...EVENT_KINDS].sort()).toEqual(
      ['adjustment', 'charge', 'charge_change', 'disbursement', 'extra_payment', 'late_policy', 'payment', 'rate_change', 'restructure', 'void'],
    );
  });
});

describe('validateEvent', () => {
  it('normalizes a stored row: id, parsed payload, createdAt', () => {
    const normalized = validateEvent(event({ payloadJson: '{"bankSplit":{"interest":180876,"charges":10000,"principal":189505}}' }));
    expect(normalized).toMatchObject({
      id: 'e1',
      debtId: 'd1',
      kind: 'payment',
      effectiveOn: '2026-03-15',
      amountMinor: 380_381,
      createdAt: '2026-03-15T10:00:00.000Z',
      payload: { bankSplit: { interest: 180876, charges: 10000, principal: 189505 } },
    });
  });

  it('accepts an already parsed payload and plain id/createdAt fields', () => {
    const normalized = validateEvent({ id: 'x', kind: 'extra_payment', effectiveOn: '2026-04-01', amountMinor: 300_000, payload: { strategy: 'reduce_term' } });
    expect(normalized).toMatchObject({ id: 'x', payload: { strategy: 'reduce_term' }, createdAt: '' });
  });

  it('validates each payload shape', () => {
    expect(validateEvent(event({ kind: 'disbursement', amountMinor: 10_000_000 })).payload).toEqual({});
    expect(validateEvent(event({ kind: 'rate_change', amountMinor: 0, payloadJson: JSON.stringify({ rate: EA(30), mode: 'keep_term' }) })).payload.rate).toEqual(EA(30));
    expect(
      validateEvent(event({ kind: 'charge_change', amountMinor: 0, payloadJson: JSON.stringify({ charges: [{ id: 'fee', kind: 'fee', basis: 'fixed', value: 10_000 }] }) })).payload.charges[0],
    ).toMatchObject({ id: 'fee', cadence: 'per_installment', display: 'itemized' });
    expect(validateEvent(event({ kind: 'adjustment', amountMinor: 0, payloadJson: '{"balanceMinor":9000000,"note":"statement"}' })).payload).toMatchObject({ balanceMinor: 9_000_000 });
    expect(validateEvent(event({ kind: 'void', amountMinor: 0, payloadJson: '{"targetEventId":"e0","reason":"typo"}' })).payload).toEqual({ targetEventId: 'e0', reason: 'typo' });
    expect(validateEvent(event({ kind: 'charge', payloadJson: '{"trancheType":"deferred","label":"TV","n":12}' })).payload.trancheType).toBe('deferred');
    const terms = { kind: 'consumer', principalMinor: 5_000_000, openedOn: '2026-05-01', rate: EA(20), system: 'french', periodicity: 'monthly', n: 12, firstDueOn: '2026-06-01' };
    expect(validateEvent(event({ kind: 'restructure', amountMinor: 0, payloadJson: JSON.stringify({ terms }) })).payload.terms).toMatchObject({ schemaVersion: 1, n: 12, charges: [] });
  });

  it('rejects malformed events with a stable code', () => {
    expect(code(() => validateEvent(event({ kind: 'refund' })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ $id: '' })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ effectiveOn: '2026-02-30' })))).toBe('invalid_date');
    expect(code(() => validateEvent(event({ amountMinor: -5 })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ amountMinor: 1.5 })))).toBe('invalid_minor');
    expect(code(() => validateEvent(event({ payloadJson: '{oops' })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ amountMinor: 0 })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ kind: 'extra_payment', payloadJson: '{"strategy":"double"}' })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ kind: 'rate_change', amountMinor: 0, payloadJson: '{"rate":{"value":30,"basis":"effective","periodicity":"annual","timing":"arrears"},"mode":"later"}' })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ kind: 'void', amountMinor: 0, payloadJson: '{}' })))).toBe('invalid_event');
    expect(code(() => validateEvent(event({ kind: 'adjustment', amountMinor: 0, payloadJson: '{"balanceMinor":-1}' })))).toBe('invalid_event');
  });

  it('requires a bank split to add up to the amount and rejects bad buckets', () => {
    const split = (value) => event({ payloadJson: JSON.stringify({ bankSplit: value }) });
    expect(validateEvent(split({ interest: 180_876, charges: 10_000, principal: 189_505 })).payload.bankSplit.principal).toBe(189_505);
    expect(code(() => validateEvent(split({ interest: 180_876, charges: 10_000, principal: 1 })))).toBe('invalid_bank_split');
    expect(code(() => validateEvent(split({ interest: -1, principal: 380_382 })))).toBe('invalid_bank_split');
    expect(code(() => validateEvent(split({ fees: 380_381 })))).toBe('invalid_bank_split');
  });
});

describe('sortEvents', () => {
  it('orders by effectiveOn, then createdAt, then id, without mutating the input', () => {
    const input = [
      event({ $id: 'c', effectiveOn: '2026-04-01', $createdAt: '2026-04-01T09:00:00Z' }),
      event({ $id: 'b', effectiveOn: '2026-03-01', $createdAt: '2026-03-01T12:00:00Z' }),
      event({ $id: 'a', effectiveOn: '2026-03-01', $createdAt: '2026-03-01T08:00:00Z' }),
      event({ $id: 'z', effectiveOn: '2026-03-01', $createdAt: '2026-03-01T12:00:00Z' }),
    ];
    const ids = sortEvents(input).map((item) => item.id ?? item.$id);
    expect(ids).toEqual(['a', 'b', 'z', 'c']);
    expect(input.map((item) => item.$id)).toEqual(['c', 'b', 'a', 'z']);
  });

  it('is independent of the storage order (200 seeded shuffles)', () => {
    const random = mulberry32(7);
    const base = Array.from({ length: 12 }, (_, index) =>
      event({ $id: `e${index}`, effectiveOn: `2026-0${1 + Math.floor(random() * 3)}-10`, $createdAt: `2026-01-01T00:00:0${index % 4}Z` }),
    );
    const expected = sortEvents(base).map((item) => item.$id);
    for (let round = 0; round < 200; round += 1) {
      const shuffled = base.slice();
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
      }
      expect(sortEvents(shuffled).map((item) => item.$id)).toEqual(expected);
    }
  });
});

describe('activeEvents', () => {
  const payment = (id) => event({ $id: id });
  const voidOf = (id, target) => event({ $id: id, kind: 'void', amountMinor: 0, payloadJson: JSON.stringify({ targetEventId: target, reason: 'typo' }) });

  it('drops voided events and the void events themselves', () => {
    const active = activeEvents([payment('p1'), payment('p2'), voidOf('v1', 'p1')]);
    expect(active.map((item) => item.id)).toEqual(['p2']);
  });

  it('keeps everything when nothing is voided', () => {
    expect(activeEvents([payment('p1'), payment('p2')]).map((item) => item.id)).toEqual(['p1', 'p2']);
  });

  it('ignores a void that points at a missing event or at another void (voids cannot be undone)', () => {
    const active = activeEvents([payment('p1'), voidOf('v1', 'ghost'), voidOf('v2', 'p1'), voidOf('v3', 'v2')]);
    expect(active.map((item) => item.id)).toEqual([]);
    expect(activeEvents([payment('p1'), voidOf('v1', 'ghost')]).map((item) => item.id)).toEqual(['p1']);
  });
});
