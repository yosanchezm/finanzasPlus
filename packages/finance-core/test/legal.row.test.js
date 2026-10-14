// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { legalRateId, legalValueInRange } from '../src/legal.js';

// The deterministic row id and the value guard are shared by the web (`upsertLegalRate`) and Nia (`legal_rate`),
// so the same key always lands on the same row from both.

describe('legalRateId', () => {
  const household = 'household-test';

  it('builds lr + kind letter + modality code + yyyymm + household', () => {
    expect(legalRateId({ kind: 'usury', modality: 'consumer', validFrom: '2026-11-01' }, household)).toBe('lruco202611household-test');
    expect(legalRateId({ kind: 'ibc', modality: 'consumer', validFrom: '2026-11-01' }, household)).toBe('lrico202611household-test');
    expect(legalRateId({ kind: 'usury', modality: 'mortgage', validFrom: '2026-12-01' }, household)).toBe('lrumg202612household-test');
    expect(legalRateId({ kind: 'smmlv', modality: 'all', validFrom: '2027-01-01' }, household)).toBe('lrsal202701household-test');
  });

  it('gives each modality its own two-letter code', () => {
    const codes = ['consumer', 'low_amount', 'productive', 'productive_rural', 'productive_urban', 'popular_rural', 'popular_urban', 'mortgage']
      .map((modality) => legalRateId({ kind: 'usury', modality, validFrom: '2026-11-01' }, 'h').slice(3, 5));

    expect(codes).toEqual(['co', 'lo', 'pd', 'pr', 'pu', 'qr', 'qu', 'mg']);
  });

  it('keeps the id within the 36 characters Appwrite allows by cutting the household at 25', () => {
    const id = legalRateId({ kind: 'usury', modality: 'consumer', validFrom: '2026-11-01' }, 'h'.repeat(36));

    expect(id).toBe(`lruco202611${'h'.repeat(25)}`);
    expect(id).toHaveLength(36);
  });

  it('is the same for the same key and different for another month', () => {
    const key = { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01' };

    expect(legalRateId(key, household)).toBe(legalRateId({ ...key, validTo: '2026-11-30', value: 2820 }, household));
    expect(legalRateId({ ...key, validFrom: '2026-12-01' }, household)).not.toBe(legalRateId(key, household));
  });
});

describe('legalValueInRange', () => {
  it('accepts basis points from 500 to 10000 for ibc and usury, and nothing else', () => {
    expect(legalValueInRange('usury', 2820)).toBe(true);
    expect(legalValueInRange('ibc', 500)).toBe(true);
    expect(legalValueInRange('ibc', 10000)).toBe(true);
    expect(legalValueInRange('usury', 499)).toBe(false);
    expect(legalValueInRange('usury', 282)).toBe(false);
    expect(legalValueInRange('usury', 10001)).toBe(false);
    expect(legalValueInRange('usury', 2820.5)).toBe(false);
    expect(legalValueInRange('usury', '2820')).toBe(false);
  });

  it('accepts whole pesos from 100,000 to 100,000,000 for the SMMLV', () => {
    expect(legalValueInRange('smmlv', 1750905)).toBe(true);
    expect(legalValueInRange('smmlv', 100000)).toBe(true);
    expect(legalValueInRange('smmlv', 100000000)).toBe(true);
    expect(legalValueInRange('smmlv', 99999)).toBe(false);
    expect(legalValueInRange('smmlv', 100000001)).toBe(false);
    expect(legalValueInRange('smmlv', 1750905.5)).toBe(false);
  });

  it('refuses an unknown kind', () => {
    expect(legalValueInRange('mora', 2820)).toBe(false);
  });
});
