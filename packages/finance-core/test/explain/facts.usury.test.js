// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { explainFacts } from '../../src/explain/explain.js';
import { resolveLegal } from '../../src/legal.js';
import { debt, deepFreeze, french, interestFree } from '../helpers/loans.js';
import { reviewedCopy } from '../helpers/explainCopy.js';

const copy = reviewedCopy();
// IBC 19.06 % EA gives a usury cap of 28.59 % EA for October 2026.
const IBC = resolveLegal([{ kind: 'ibc', modality: 'consumer', value: 1906, validFrom: '2026-10-01', validTo: '2026-10-31', source: 'Superfinanciera', verified: true }]);
const facts = (row, today, opts = {}, legal = IBC) => explainFacts('usury_ibc', row, [], legal, today, { copy, ...opts });
const codes = (result) => result.notices.map((notice) => notice.code);

describe('explain facts: usury_ibc', () => {
  it('shows the cap in force with its month, origin and the IBC behind it', () => {
    const result = facts(debt(french()), '2026-10-13');

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt' });
    expect(result.numbers).toMatchObject({ capEA: 28.59, ibcEA: 19.06, rateEA: 24 });
    expect(result.text).toMatchObject({ cap: '28,59 %', ibc: '19,06 %', month: 'octubre de 2026', origin: 'ibc', modality: 'consumer', rateEA: '24 %' });
    expect(result.approximate).toEqual([]);
    expect(codes(result)).toEqual([]);
  });

  it('derives the IBC from a cap of the code table and marks it approximate', () => {
    const result = facts(debt(french()), '2026-10-13', {}, null);

    expect(result.numbers).toMatchObject({ capEA: 28.59, ibcEA: 19.06 });
    expect(result.text).toMatchObject({ origin: 'default', ibc: '19,06 %' });
    expect(result.approximate).toEqual(['ibc']);
  });

  it('shows a carried-forward cap with a stale warning and never blocks', () => {
    const result = facts(debt(french()), '2026-12-05');

    expect(result.status).toBe('ok');
    expect(result.numbers.capEA).toBe(28.59);
    expect(codes(result)).toEqual(['usury_stale']);
    expect(result.text.lastValidTo).toBe('31 de octubre de 2026');
  });

  it('says so when no cap is known for the modality', () => {
    const result = facts(debt(french({ kind: 'mortgage' })), '2026-10-13');

    expect(result.status).toBe('ok');
    expect(result.numbers.capEA).toBeUndefined();
    expect(result.numbers.rateEA).toBe(24);
    expect(codes(result)).toEqual(['cap_unknown', 'ley546_no_computation']);
    expect(result.text.modality).toBe('mortgage');
  });

  it('explains Ley 546 for a mortgage without computing anything, whether or not a cap is registered', () => {
    const table = resolveLegal([{ kind: 'usury', modality: 'mortgage', value: 2400, validFrom: '2026-10-01', validTo: '2026-10-31', source: 'Manual', verified: true }]);
    const withCap = facts(debt(french({ kind: 'mortgage' })), '2026-10-13', {}, table);
    const consumer = facts(debt(french()), '2026-10-13');

    expect(withCap.numbers.capEA).toBe(24);
    expect(codes(withCap)).toEqual(['ley546_no_computation']);
    expect(withCap.copyKeys).toEqual(['legal.usury_ibc', 'legal.ley546', 'usury_ibc.sample']);
    expect(codes(consumer)).not.toContain('ley546_no_computation');
  });

  it('warns when the stated rate is above the cap and not when it is below', () => {
    const above = facts(null, '2026-10-13', { stated: { convention: 'EA', value: 35 } });
    const below = facts(null, '2026-10-13', { stated: { convention: 'EA', value: 20 } });

    expect(above).toMatchObject({ status: 'ok', dataSource: 'stated' });
    expect(above.numbers.rateEA).toBe(35);
    expect(codes(above)).toEqual(['usury_above_cap']);
    expect(codes(below)).toEqual([]);
  });

  it('flags a cap that is not officially verified', () => {
    const unverified = resolveLegal([{ kind: 'usury', modality: 'consumer', value: 2859, validFrom: '2026-10-01', validTo: '2026-10-31' }]);

    expect(codes(facts(debt(french()), '2026-10-13', {}, unverified))).toEqual(['usury_unverified']);
  });

  it('compares a 0 % family loan with the cap and finds it below', () => {
    const result = facts(debt(interestFree()), '2026-10-13');

    expect(result.numbers).toMatchObject({ capEA: 28.59, rateEA: 0 });
    expect(codes(result)).toEqual([]);
  });

  it('is generic with the public cap and no debt figures when there is no debt and no stated rate', () => {
    const result = facts(null, '2026-10-13');

    expect(result).toMatchObject({ status: 'generic', dataSource: 'generic', debt: null });
    expect(result.numbers).toEqual({ capEA: 28.59, ibcEA: 19.06 });
    expect(result.numbers.rateEA).toBeUndefined();
  });

  it('does not change frozen inputs', () => {
    expect(() => explainFacts('usury_ibc', deepFreeze(debt(french())), deepFreeze([]), IBC, '2026-10-13', deepFreeze({ copy }))).not.toThrow();
  });
});
