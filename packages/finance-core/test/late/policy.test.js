// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/errors.js';
import { DEFAULT_LEGAL, resolveLegal } from '../../src/legal.js';
import {
  LATE_MODES,
  dailyRate,
  defaultLateFor,
  lateEAOn,
  lateRateOn,
  modalityOf,
  normalizeLate,
} from '../../src/late/policy.js';

const contract = (value = 24) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const terms = (extra = {}) => ({ kind: 'consumer', rate: contract(), ...extra });
const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return null;
};
// Two consecutive cap periods, as in the spec scenario "Cap changes mid-way".
const midway = resolveLegal([], {
  usuryTable: [
    { modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-05', capEA: 28.59, source: 's', verified: true },
    { modality: 'consumer', validFrom: '2026-10-06', validTo: '2026-10-31', capEA: 27.5, source: 's', verified: false },
  ],
});
const withMortgageCap = resolveLegal([], {
  usuryTable: [{ modality: 'mortgage', validFrom: '2026-10-01', validTo: '2026-10-31', capEA: 14.5, source: 's', verified: true }],
});

describe('LATE_MODES', () => {
  it('lists the four modes in design order', () => {
    expect(LATE_MODES).toEqual(['none', 'usury', 'fixed', 'contract_multiple']);
  });
});

describe('normalizeLate', () => {
  it('treats an absent policy as mode none with no grace', () => {
    expect(normalizeLate(undefined)).toEqual({ mode: 'none', graceDays: 0 });
  });

  it('keeps usury and none as plain modes and drops fields the mode does not use', () => {
    expect(normalizeLate({ mode: 'usury' })).toEqual({ mode: 'usury', graceDays: 0 });
    expect(normalizeLate({ mode: 'usury', graceDays: 5, rate: contract(40), multiple: 2 })).toEqual({ mode: 'usury', graceDays: 5 });
    expect(normalizeLate({ mode: 'none', graceDays: 3 })).toEqual({ mode: 'none', graceDays: 3 });
  });

  it('fixed needs a rate above zero and returns it in structured form', () => {
    expect(codeOf(() => normalizeLate({ mode: 'fixed' }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({ mode: 'fixed', rate: contract(0) }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({ mode: 'fixed', rate: { convention: 'ZERO' } }))).toBe('invalid_late');
    expect(normalizeLate({ mode: 'fixed', rate: { convention: 'EA', value: 40 } })).toEqual({
      mode: 'fixed',
      rate: contract(40),
      graceDays: 0,
    });
    expect(codeOf(() => normalizeLate({ mode: 'fixed', rate: { convention: 'XX', value: 40 } }))).toBe('invalid_rate');
  });

  it('contract_multiple needs a multiple inside (0, 3]', () => {
    expect(codeOf(() => normalizeLate({ mode: 'contract_multiple' }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({ mode: 'contract_multiple', multiple: 0 }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({ mode: 'contract_multiple', multiple: -1 }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({ mode: 'contract_multiple', multiple: 3.01 }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({ mode: 'contract_multiple', multiple: Number.NaN }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({ mode: 'contract_multiple', multiple: '2' }))).toBe('invalid_late');
    expect(normalizeLate({ mode: 'contract_multiple', multiple: 0.5 })).toEqual({ mode: 'contract_multiple', multiple: 0.5, graceDays: 0 });
    expect(normalizeLate({ mode: 'contract_multiple', multiple: 3 })).toEqual({ mode: 'contract_multiple', multiple: 3, graceDays: 0 });
  });

  it('graceDays is a whole number from 0 to 90', () => {
    expect(normalizeLate({ mode: 'usury', graceDays: 0 }).graceDays).toBe(0);
    expect(normalizeLate({ mode: 'usury', graceDays: 90 }).graceDays).toBe(90);
    for (const graceDays of [-1, 91, 1.5, '3', Number.NaN]) {
      expect(codeOf(() => normalizeLate({ mode: 'usury', graceDays }))).toBe('invalid_late');
    }
  });

  it('rejects unknown modes and non-object policies', () => {
    expect(codeOf(() => normalizeLate({ mode: 'bogus' }))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate({}))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate('usury'))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate(null))).toBe('invalid_late');
    expect(codeOf(() => normalizeLate([]))).toBe('invalid_late');
  });

  it('never mutates its input', () => {
    const input = { mode: 'fixed', rate: { convention: 'EA', value: 40 } };
    normalizeLate(input);
    expect(input).toEqual({ mode: 'fixed', rate: { convention: 'EA', value: 40 } });
  });
});

describe('modalityOf', () => {
  it('derives mortgage for mortgages and consumer for every other kind', () => {
    expect(modalityOf({ kind: 'mortgage' })).toBe('mortgage');
    for (const kind of ['consumer', 'vehicle', 'libranza', 'leasing', 'card', 'family', 'informal', 'other']) {
      expect(modalityOf({ kind })).toBe('consumer');
    }
  });

  it('lets terms.modality override the derived one in both directions', () => {
    expect(modalityOf({ kind: 'consumer', modality: 'low_amount' })).toBe('low_amount');
    expect(modalityOf({ kind: 'mortgage', modality: 'consumer' })).toBe('consumer');
    expect(modalityOf({ kind: 'vehicle', modality: 'mortgage' })).toBe('mortgage');
  });
});

describe('defaultLateFor', () => {
  it('defaults bank kinds to usury and personal kinds to none', () => {
    for (const kind of ['consumer', 'vehicle', 'libranza', 'leasing', 'mortgage', 'card']) {
      expect(defaultLateFor(kind)).toEqual({ mode: 'usury', graceDays: 0 });
    }
    for (const kind of ['family', 'informal', 'other']) {
      expect(defaultLateFor(kind)).toEqual({ mode: 'none', graceDays: 0 });
    }
  });

  it('returns a fresh object each call and an unknown kind falls back to none', () => {
    const first = defaultLateFor('consumer');
    first.mode = 'fixed';
    expect(defaultLateFor('consumer').mode).toBe('usury');
    expect(defaultLateFor('spaceship')).toEqual({ mode: 'none', graceDays: 0 });
  });
});

describe('dailyRate', () => {
  it('converts an EA percent into the simple daily rate (1+EA)^(1/365)-1', () => {
    expect(dailyRate(28.59)).toBeCloseTo(0.00068917, 8);
    expect(dailyRate(28.59)).toBeCloseTo(0.000689165756, 12);
    expect(dailyRate(27.5)).toBeCloseTo(0.000665827534, 12);
    expect(dailyRate(40)).toBeCloseTo(0.000922266771, 12);
  });

  it('is exactly zero at 0% EA and rejects negative or non-finite rates', () => {
    expect(dailyRate(0)).toBe(0);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '28.59', undefined]) {
      expect(codeOf(() => dailyRate(bad))).toBe('invalid_rate');
    }
  });
});

describe('lateEAOn', () => {
  it('is 0 with no notices when the policy is absent or none', () => {
    expect(lateEAOn(terms(), '2026-10-20', DEFAULT_LEGAL)).toEqual({ ea: 0, notices: [] });
    expect(lateEAOn(terms({ late: { mode: 'none', graceDays: 0 } }), '2026-10-20', DEFAULT_LEGAL)).toEqual({ ea: 0, notices: [] });
    expect(lateEAOn(terms({ kind: 'mortgage', late: { mode: 'none', graceDays: 0 } }), '2026-10-20', DEFAULT_LEGAL)).toEqual({ ea: 0, notices: [] });
  });

  it('usury uses the cap of the day for the modality', () => {
    const late = { mode: 'usury', graceDays: 0 };
    expect(lateEAOn(terms({ late }), '2026-10-20', DEFAULT_LEGAL)).toEqual({ ea: 28.59, notices: [] });
    expect(lateEAOn(terms({ late }), '2026-10-03', midway).ea).toBe(28.59);
    expect(lateEAOn(terms({ late }), '2026-10-08', midway).ea).toBe(27.5);
  });

  it('fixed is capped per day: min(rate, cap)', () => {
    const fixed = (value) => terms({ late: { mode: 'fixed', rate: contract(value), graceDays: 0 } });
    expect(lateEAOn(fixed(40), '2026-10-20', DEFAULT_LEGAL).ea).toBe(28.59);
    expect(lateEAOn(fixed(20), '2026-10-20', DEFAULT_LEGAL).ea).toBe(20);
    expect(lateEAOn(fixed(28), '2026-10-03', midway).ea).toBe(28);
    expect(lateEAOn(fixed(28), '2026-10-08', midway).ea).toBe(27.5);
  });

  it('fixed converts a non-EA rate to EA before capping', () => {
    const late = { mode: 'fixed', rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' }, graceDays: 0 };
    const { ea } = lateEAOn(terms({ late }), '2026-10-20', DEFAULT_LEGAL);
    expect(ea).toBeCloseTo(26.8242, 3);
  });

  it('contract_multiple is min(multiple x contract EA, cap)', () => {
    const multiple = (m, rate = 24) => terms({ rate: contract(rate), late: { mode: 'contract_multiple', multiple: m, graceDays: 0 } });
    expect(lateEAOn(multiple(1.5), '2026-10-20', DEFAULT_LEGAL).ea).toBe(28.59);
    expect(lateEAOn(multiple(1), '2026-10-20', DEFAULT_LEGAL).ea).toBe(24);
    expect(lateEAOn(multiple(0.5), '2026-10-20', DEFAULT_LEGAL).ea).toBe(12);
    expect(lateEAOn(multiple(1.5, 12), '2026-10-20', DEFAULT_LEGAL).ea).toBe(18);
  });

  it('a stale cap is carried forward and flagged', () => {
    const result = lateEAOn(terms({ late: { mode: 'usury', graceDays: 0 } }), '2026-12-05', DEFAULT_LEGAL);
    expect(result.ea).toBe(28.59);
    expect(result.notices).toEqual([
      expect.objectContaining({ code: 'late_cap_stale', severity: 'info', blocking: false, modality: 'consumer', lastValidTo: '2026-10-31', asOf: '2026-12-05' }),
    ]);
  });

  it('with no cap at all it uses the policy rate and raises late_cap_unknown, for every mode', () => {
    const day = '2026-09-15'; // before the first known cap
    const usury = lateEAOn(terms({ late: { mode: 'usury', graceDays: 0 } }), day, DEFAULT_LEGAL);
    expect(usury.ea).toBe(24);
    expect(usury.notices).toEqual([expect.objectContaining({ code: 'late_cap_unknown', blocking: false, modality: 'consumer', asOf: day })]);
    const fixed = lateEAOn(terms({ late: { mode: 'fixed', rate: contract(40), graceDays: 0 } }), day, DEFAULT_LEGAL);
    expect(fixed.ea).toBe(40);
    expect(fixed.notices.map((notice) => notice.code)).toEqual(['late_cap_unknown']);
    const multiple = lateEAOn(terms({ late: { mode: 'contract_multiple', multiple: 2, graceDays: 0 } }), day, DEFAULT_LEGAL);
    expect(multiple.ea).toBe(48);
    expect(multiple.notices.map((notice) => notice.code)).toEqual(['late_cap_unknown']);
  });

  it('a mortgage with no explicit cap uses the contract EA with late_cap_unknown and late_mortgage_unverified', () => {
    const result = lateEAOn(terms({ kind: 'mortgage', late: { mode: 'usury', graceDays: 0 } }), '2026-10-20', DEFAULT_LEGAL);
    expect(result.ea).toBe(24);
    expect(result.notices.map((notice) => notice.code)).toEqual(['late_cap_unknown', 'late_mortgage_unverified']);
  });

  it('a mortgage with an explicit cap is capped and only flagged as unverified', () => {
    const result = lateEAOn(terms({ kind: 'mortgage', late: { mode: 'usury', graceDays: 0 } }), '2026-10-20', withMortgageCap);
    expect(result.ea).toBe(14.5);
    expect(result.notices).toEqual([expect.objectContaining({ code: 'late_mortgage_unverified', blocking: false, modality: 'mortgage' })]);
  });

  it('terms.modality picks the cap table row', () => {
    const late = { mode: 'usury', graceDays: 0 };
    expect(lateEAOn(terms({ modality: 'mortgage', late }), '2026-10-20', withMortgageCap).ea).toBe(14.5);
    expect(lateEAOn(terms({ kind: 'mortgage', modality: 'consumer', late }), '2026-10-20', DEFAULT_LEGAL)).toEqual({ ea: 28.59, notices: [] });
  });

  it('uses the code tables when no legal is given and rejects a bad day', () => {
    const late = { mode: 'usury', graceDays: 0 };
    expect(lateEAOn(terms({ late }), '2026-10-20').ea).toBe(28.59);
    expect(codeOf(() => lateEAOn(terms({ late }), '2026-13-40', DEFAULT_LEGAL))).toBe('invalid_date');
    expect(codeOf(() => lateEAOn(terms({ late }), undefined, DEFAULT_LEGAL))).toBe('invalid_date');
  });
});

describe('lateRateOn', () => {
  it('adds the simple daily rate to the EA of the day', () => {
    const result = lateRateOn(terms({ late: { mode: 'usury', graceDays: 0 } }), '2026-10-20', DEFAULT_LEGAL);
    expect(result.ea).toBe(28.59);
    expect(result.daily).toBeCloseTo(0.00068917, 8);
    expect(result.notices).toEqual([]);
    const mid = lateRateOn(terms({ late: { mode: 'usury', graceDays: 0 } }), '2026-10-08', midway);
    expect(mid.daily).toBeCloseTo(0.000665827534, 12);
  });

  it('is zero for mode none and keeps the notices of the day', () => {
    expect(lateRateOn(terms(), '2026-10-20', DEFAULT_LEGAL)).toEqual({ ea: 0, daily: 0, notices: [] });
    const stale = lateRateOn(terms({ late: { mode: 'usury', graceDays: 0 } }), '2026-12-05', DEFAULT_LEGAL);
    expect(stale.notices.map((notice) => notice.code)).toEqual(['late_cap_stale']);
  });
});
