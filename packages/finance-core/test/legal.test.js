// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SMMLV_TABLE, USURY_TABLE, ley1555Notice, usuryNotice } from '../src/legal.js';
import { normalizeRate } from '../src/rates.js';

// Tables are injected so these tests never depend on the shipped values.
const TABLE = [
  { modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-31', capEA: 28.59, source: 'test fixture', verified: true },
  { modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', capEA: 27.1, source: 'test fixture', verified: true },
];

const ea = (value) => normalizeRate({ convention: 'EA', value });

describe('usuryNotice', () => {
  it('warns with the cap and asOf when the EA exceeds the cap for the modality', () => {
    const notice = usuryNotice(ea(30), 'consumer', '2026-10-12', { usuryTable: TABLE });
    expect(notice).toMatchObject({
      code: 'usury_above_cap',
      severity: 'warning',
      blocking: false,
      modality: 'consumer',
      capEA: 28.59,
      eaPercent: 30,
      asOf: '2026-10-12',
      validFrom: '2026-10-01',
      validTo: '2026-10-31',
      verified: true,
    });
  });

  it('converts the stated rate to EA before comparing, so 2.6% monthly is above a 28.59% cap', () => {
    // 1.026^12 - 1 = 36.0% EA
    const notice = usuryNotice(normalizeRate({ convention: 'MV', value: 2.6 }), 'consumer', '2026-10-12', { usuryTable: TABLE });
    expect(notice.code).toBe('usury_above_cap');
    expect(notice.eaPercent).toBeCloseTo(36.0, 0);
    // 1.021^12 - 1 = 28.32% EA is below the cap
    expect(usuryNotice(normalizeRate({ convention: 'MV', value: 2.1 }), 'consumer', '2026-10-12', { usuryTable: TABLE })).toBeNull();
  });

  it('returns no warning below the cap or exactly at it', () => {
    expect(usuryNotice(ea(24), 'consumer', '2026-10-12', { usuryTable: TABLE })).toBeNull();
    expect(usuryNotice(ea(28.59), 'consumer', '2026-10-12', { usuryTable: TABLE })).toBeNull();
  });

  it('picks the cap whose validity window contains asOf', () => {
    expect(usuryNotice(ea(28), 'consumer', '2026-10-31', { usuryTable: TABLE })).toBeNull();
    const november = usuryNotice(ea(28), 'consumer', '2026-11-01', { usuryTable: TABLE });
    expect(november).toMatchObject({ capEA: 27.1, asOf: '2026-11-01' });
  });

  it('returns no warning and does not throw when no cap entry exists', () => {
    expect(usuryNotice(ea(99), 'microcredit', '2026-10-12', { usuryTable: TABLE })).toBeNull();
    expect(usuryNotice(ea(99), 'consumer', '2026-12-15', { usuryTable: TABLE })).toBeNull();
    expect(usuryNotice(ea(99), 'consumer', '2026-10-12', { usuryTable: [] })).toBeNull();
  });

  it('never throws on bad input: notices are best effort and never block', () => {
    expect(usuryNotice({ value: -5 }, 'consumer', '2026-10-12', { usuryTable: TABLE })).toBeNull();
    expect(usuryNotice(ea(30), 'consumer', 'not-a-date', { usuryTable: TABLE })).toBeNull();
    expect(usuryNotice(undefined, 'consumer', '2026-10-12', { usuryTable: TABLE })).toBeNull();
  });

  it('flags a cap that is not officially verified', () => {
    const table = [{ ...TABLE[0], verified: false }];
    expect(usuryNotice(ea(30), 'consumer', '2026-10-12', { usuryTable: table })).toMatchObject({ verified: false });
  });
});

describe('shipped tables', () => {
  it('holds the single known consumer cap, marked unverified, for October 2026', () => {
    expect(USURY_TABLE).toHaveLength(1);
    expect(USURY_TABLE[0]).toMatchObject({
      modality: 'consumer',
      validFrom: '2026-10-01',
      validTo: '2026-10-31',
      capEA: 28.59,
      verified: false,
    });
    expect(typeof USURY_TABLE[0].source).toBe('string');
    expect(USURY_TABLE[0].source.length).toBeGreaterThan(10);
  });

  it('uses the shipped cap by default and warns for 30% EA in October 2026', () => {
    expect(usuryNotice(ea(30), 'consumer', '2026-10-12')).toMatchObject({ capEA: 28.59, verified: false });
    expect(usuryNotice(ea(24), 'consumer', '2026-10-12')).toBeNull();
    expect(usuryNotice(ea(30), 'consumer', '2026-09-30')).toBeNull();
  });

  it('ships an empty SMMLV table until the owner supplies official values', () => {
    expect(Array.isArray(SMMLV_TABLE)).toBe(true);
    expect(SMMLV_TABLE).toHaveLength(0);
  });
});

describe('ley1555Notice', () => {
  it('says the scope is unverified for a mortgage and includes asOf', () => {
    const notice = ley1555Notice({ kind: 'mortgage' }, '2026-10-12');
    expect(notice).toMatchObject({
      code: 'ley1555_scope_unverified',
      severity: 'info',
      blocking: false,
      scopeVerified: false,
      asOf: '2026-10-12',
    });
    expect(notice.message).toContain('2026-10-12');
    expect(notice.message).toContain('unverified');
  });

  it('is not raised for other kinds of debt', () => {
    expect(ley1555Notice({ kind: 'consumer' }, '2026-10-12')).toBeNull();
    expect(ley1555Notice({ kind: 'card' }, '2026-10-12')).toBeNull();
  });

  it('never throws on bad input', () => {
    expect(ley1555Notice(undefined, '2026-10-12')).toBeNull();
    expect(ley1555Notice({ kind: 'mortgage' }, 'soon')).toBeNull();
  });
});
