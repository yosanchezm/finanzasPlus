// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { explainFacts } from '../../src/explain/explain.js';
import { EA, debt, deepFreeze, ev, french, interestFree } from '../helpers/loans.js';
import { reviewedCopy } from '../helpers/explainCopy.js';

const TODAY = '2026-10-13';
const copy = reviewedCopy();
const facts = (row, opts = {}, events = []) => explainFacts('rate_conventions', row, events, undefined, TODAY, { copy, ...opts });
const rateChange = (on, value, id) => ev('rate_change', on, 0, { rate: EA(value), mode: 'keep_term' }, id);

describe('explain facts: rate_conventions', () => {
  it('converts a stated 25.2 % NAMV to 2.1 % MV and about 28.32 % EA', () => {
    const result = facts(null, { stated: { convention: 'NAMV', value: 25.2 } });

    expect(result).toMatchObject({ topic: 'rate_conventions', status: 'ok', dataSource: 'stated', debt: null });
    expect(result.numbers).toMatchObject({ stated: 25.2, monthly: 2.1 });
    expect(result.numbers.ea).toBeCloseTo(28.3243, 4);
    expect(result.text).toEqual({ stated: '25,2 %', convention: 'NAMV', monthly: '2,1 %', ea: '28,32 %' });
    expect(result.approximate).toEqual(['ea']);
  });

  it('shows a stated 2.1 % MV as about 28.32 % EA with an exact monthly rate', () => {
    const result = facts(null, { stated: { convention: 'MV', value: 2.1 } });

    expect(result.text).toMatchObject({ stated: '2,1 %', convention: 'MV', monthly: '2,1 %', ea: '28,32 %' });
    expect(result.approximate).toEqual(['ea']);
  });

  it('keeps an EA exact and marks only its monthly equivalent', () => {
    const result = facts(null, { stated: { convention: 'EA', value: 24 } });

    expect(result.text).toMatchObject({ stated: '24 %', convention: 'EA', ea: '24 %', monthly: '1,81 %' });
    expect(result.approximate).toEqual(['monthly']);
  });

  it('uses the rate in force of a debt, after its rate changes', () => {
    const loan = debt(french({ rate: EA(24) }));
    const result = facts(loan, {}, [rateChange('2026-03-01', 20, 'r1')]);

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { id: 'd1', name: 'Credito', kind: 'loan' } });
    expect(result.numbers).toMatchObject({ stated: 20, ea: 20 });
    expect(result.text).toMatchObject({ stated: '20 %', convention: 'EA' });
  });

  it('lets a rate the user states win over the debt rate', () => {
    const result = facts(debt(french()), { stated: { convention: 'NAMV', value: 25.2 } });

    expect(result).toMatchObject({ dataSource: 'stated', debt: { id: 'd1' } });
    expect(result.text.stated).toBe('25,2 %');
  });

  it('explains a 0 % family loan as interest free', () => {
    const result = facts(debt(interestFree()));

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt' });
    expect(result.numbers).toMatchObject({ stated: 0, ea: 0, monthly: 0 });
    expect(result.text).toMatchObject({ convention: 'ZERO', ea: '0 %', monthly: '0 %' });
  });

  it('is generic, with no figures, when there is neither a debt nor a stated rate', () => {
    const result = facts(null);

    expect(result).toMatchObject({ status: 'generic', dataSource: 'generic', debt: null, numbers: {}, text: {}, approximate: [] });
    expect(result.copy.length).toBeGreaterThan(0);
  });

  it('does not change a frozen debt, its events or its options', () => {
    const loan = deepFreeze(debt(french()));
    const events = deepFreeze([rateChange('2026-03-01', 20, 'r1')]);
    const opts = deepFreeze({ stated: { convention: 'NAMV', value: 25.2 }, copy });

    expect(() => explainFacts('rate_conventions', loan, events, undefined, TODAY, opts)).not.toThrow();
    expect(() => explainFacts('rate_conventions', loan, events, undefined, TODAY, { copy })).not.toThrow();
  });
});
