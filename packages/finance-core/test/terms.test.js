// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TermsTooLarge, ValidationError } from '../src/errors.js';
import {
  TERMS_MAX_CHARS,
  TERMS_SCHEMA_VERSION,
  parseTerms,
  serializeTerms,
  validateTerms,
} from '../src/terms.js';

const base = () => ({
  kind: 'consumer',
  principalMinor: 10_000_000,
  openedOn: '2026-01-15',
  rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
  system: 'french',
  periodicity: 'monthly',
  n: 36,
  firstDueOn: '2026-02-15',
});

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return null;
};

describe('validateTerms: normalisation', () => {
  it('stamps schemaVersion and fills the documented defaults', () => {
    const terms = validateTerms(base());
    expect(terms.schemaVersion).toBe(TERMS_SCHEMA_VERSION);
    expect(terms.unit).toBe('COP');
    expect(terms.charges).toEqual([]);
    expect(terms.prepaymentPenaltyPct).toBe(0);
    expect(terms.roundingUnit).toBe(1);
    expect(terms.rate).toEqual({ value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
  });

  it('keeps explicit values and does not mutate its input', () => {
    const input = { ...base(), roundingUnit: 100, prepaymentPenaltyPct: 2.5, dueDay: 31, allocationOrder: ['interest', 'principal'] };
    const frozen = JSON.stringify(input);
    const terms = validateTerms(input);
    expect(terms.roundingUnit).toBe(100);
    expect(terms.prepaymentPenaltyPct).toBe(2.5);
    expect(terms.dueDay).toBe(31);
    expect(terms.allocationOrder).toEqual(['interest', 'principal']);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it('accepts a balance-only informal debt without a plan', () => {
    const terms = validateTerms({
      kind: 'informal',
      principalMinor: 500_000,
      openedOn: '2026-03-01',
      rate: { convention: 'ZERO' },
      system: 'none',
    });
    expect(terms.system).toBe('none');
    expect(terms.rate.value).toBe(0);
    expect(terms.n).toBeUndefined();
  });

  it('derives n and firstDueOn from a manual plan', () => {
    const terms = validateTerms({
      ...base(),
      system: 'manual',
      n: undefined,
      firstDueOn: undefined,
      manualPlan: [
        ['2026-03-01', 400_000],
        ['2026-04-01', 600_000],
      ],
    });
    expect(terms.n).toBe(2);
    expect(terms.firstDueOn).toBe('2026-03-01');
  });
});

describe('validateTerms: rejections', () => {
  it('rejects a negative or fractional principal', () => {
    expect(codeOf(() => validateTerms({ ...base(), principalMinor: -1 }))).toBe('invalid_principal');
    expect(codeOf(() => validateTerms({ ...base(), principalMinor: 0 }))).toBe('invalid_principal');
    expect(codeOf(() => validateTerms({ ...base(), principalMinor: 1000.5 }))).toBe('invalid_minor');
  });

  it('rejects an invalid anticipated rate', () => {
    const rate = { value: 100, basis: 'effective', periodicity: 'monthly', timing: 'advance' };
    expect(codeOf(() => validateTerms({ ...base(), rate }))).toBe('invalid_rate');
    expect(codeOf(() => validateTerms({ ...base(), lateRate: rate }))).toBe('invalid_rate');
  });

  it('rejects bad dates', () => {
    expect(codeOf(() => validateTerms({ ...base(), openedOn: '2026-02-30' }))).toBe('invalid_date');
    expect(codeOf(() => validateTerms({ ...base(), firstDueOn: '15/02/2026' }))).toBe('invalid_date');
    expect(codeOf(() => validateTerms({ ...base(), dueDay: 32 }))).toBe('invalid_terms');
  });

  it('rejects unknown kinds, systems, periodicities and bad term counts', () => {
    expect(codeOf(() => validateTerms({ ...base(), kind: 'pirate' }))).toBe('invalid_terms');
    expect(codeOf(() => validateTerms({ ...base(), system: 'balloon' }))).toBe('invalid_terms');
    expect(codeOf(() => validateTerms({ ...base(), periodicity: 'daily' }))).toBe('invalid_terms');
    expect(codeOf(() => validateTerms({ ...base(), n: 0 }))).toBe('invalid_terms');
    expect(codeOf(() => validateTerms({ ...base(), n: 12.5 }))).toBe('invalid_terms');
    expect(codeOf(() => validateTerms(null))).toBe('invalid_terms');
  });

  it('rejects a future schema version and a bad rounding unit', () => {
    expect(codeOf(() => validateTerms({ ...base(), schemaVersion: 2 }))).toBe('unsupported_schema_version');
    expect(codeOf(() => validateTerms({ ...base(), roundingUnit: 0 }))).toBe('invalid_terms');
  });

  it('validates grace and balloon against the amortization system', () => {
    expect(validateTerms({ ...base(), grace: { periods: 2, type: 'total' } }).grace).toEqual({ periods: 2, type: 'total' });
    expect(validateTerms({ ...base(), grace: { periods: 0, type: 'total' } }).grace).toBeUndefined();
    expect(codeOf(() => validateTerms({ ...base(), grace: { periods: 36, type: 'total' } }))).toBe('invalid_grace');
    expect(codeOf(() => validateTerms({ ...base(), grace: { periods: 2, type: 'sabbatical' } }))).toBe('invalid_grace');
    expect(codeOf(() => validateTerms({ ...base(), system: 'bullet', grace: { periods: 2, type: 'total' } }))).toBe('grace_unsupported');
    const interestOnly = { ...base(), system: 'interest_only', balloonMinor: 5_000_000 };
    expect(validateTerms(interestOnly).balloonMinor).toBe(5_000_000);
    expect(codeOf(() => validateTerms({ ...interestOnly, balloonMinor: 10_000_001 }))).toBe('invalid_balloon');
    expect(codeOf(() => validateTerms({ ...base(), balloonMinor: 5_000_000 }))).toBe('balloon_unsupported');
  });

  it('validates the manual plan', () => {
    const manual = { ...base(), system: 'manual' };
    expect(codeOf(() => validateTerms({ ...manual, manualPlan: [] }))).toBe('invalid_manual_plan');
    expect(codeOf(() => validateTerms({ ...manual, manualPlan: [['2026-03-01', -5]] }))).toBe('invalid_manual_plan');
    expect(
      codeOf(() =>
        validateTerms({
          ...manual,
          manualPlan: [
            ['2026-04-01', 100],
            ['2026-03-01', 100],
          ],
        }),
      ),
    ).toBe('invalid_manual_plan');
    expect(codeOf(() => validateTerms(manual))).toBe('invalid_manual_plan');
  });
});

describe('validateTerms: charges', () => {
  const fee = { id: 'fee', kind: 'fee', label: 'Estudio', basis: 'fixed', value: 10_000 };

  it('normalises a charge with defaults', () => {
    const [charge] = validateTerms({ ...base(), charges: [fee] }).charges;
    expect(charge).toEqual({
      id: 'fee',
      kind: 'fee',
      label: 'Estudio',
      basis: 'fixed',
      value: 10_000,
      cadence: 'per_installment',
      fromPeriod: 1,
      toPeriod: null,
      display: 'itemized',
    });
  });

  it('accepts pctOfCharge only against an earlier, non-subtotal charge', () => {
    const iva = { id: 'iva', kind: 'tax', basis: 'pctOfCharge', refId: 'fee', value: 19 };
    expect(validateTerms({ ...base(), charges: [fee, iva] }).charges[1].refId).toBe('fee');
    expect(codeOf(() => validateTerms({ ...base(), charges: [iva, fee] }))).toBe('invalid_charge');
    expect(codeOf(() => validateTerms({ ...base(), charges: [fee, { ...iva, refId: 'iva' }] }))).toBe('invalid_charge');
    const gmf = { id: 'gmf', kind: 'tax', basis: 'pctOfSubtotal', value: 0.4 };
    expect(codeOf(() => validateTerms({ ...base(), charges: [gmf, { ...iva, refId: 'gmf' }] }))).toBe('invalid_charge');
  });

  it('rejects malformed charges', () => {
    expect(codeOf(() => validateTerms({ ...base(), charges: [fee, fee] }))).toBe('invalid_charge');
    expect(codeOf(() => validateTerms({ ...base(), charges: [{ ...fee, basis: 'magic' }] }))).toBe('invalid_charge');
    expect(codeOf(() => validateTerms({ ...base(), charges: [{ ...fee, value: -1 }] }))).toBe('invalid_charge');
    expect(codeOf(() => validateTerms({ ...base(), charges: [{ ...fee, value: 10.5 }] }))).toBe('invalid_charge');
    expect(codeOf(() => validateTerms({ ...base(), charges: [{ ...fee, fromPeriod: 5, toPeriod: 2 }] }))).toBe('invalid_charge');
    expect(codeOf(() => validateTerms({ ...base(), charges: [{ ...fee, basis: 'pctOfBase', value: 1 }] }))).toBe('invalid_charge');
    expect(codeOf(() => validateTerms({ ...base(), charges: 'none' }))).toBe('invalid_charge');
  });
});

describe('serializeTerms / parseTerms', () => {
  it('round-trips normalised terms and always writes schemaVersion', () => {
    const text = serializeTerms(base());
    expect(JSON.parse(text).schemaVersion).toBe(TERMS_SCHEMA_VERSION);
    expect(parseTerms(text)).toEqual(validateTerms(base()));
  });

  it('throws TermsTooLarge over 8000 characters and fits a 120-row manual plan', () => {
    const plan = (rows) =>
      Array.from({ length: rows }, (_, index) => [`${2026 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-15`, 1_234_567]);
    const manual = (rows) => ({ ...base(), system: 'manual', manualPlan: plan(rows) });

    const fits = serializeTerms(manual(120));
    expect(fits.length).toBeLessThanOrEqual(TERMS_MAX_CHARS);
    expect(JSON.parse(fits).manualPlan).toHaveLength(120);

    let failure = null;
    try {
      serializeTerms(manual(400));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TermsTooLarge);
    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure.name).toBe('TermsTooLarge');
    expect(failure.code).toBe('terms_too_large');
  });

  it('migrates a pre-versioned document (version 0) to the current schema', () => {
    const legacy = JSON.stringify(base());
    expect(JSON.parse(legacy).schemaVersion).toBeUndefined();
    const parsed = parseTerms(legacy);
    expect(parsed.schemaVersion).toBe(TERMS_SCHEMA_VERSION);
    expect(parsed.n).toBe(36);
  });

  it('rejects a newer schema, malformed JSON and non-object documents', () => {
    expect(codeOf(() => parseTerms(JSON.stringify({ ...base(), schemaVersion: 9 })))).toBe('unsupported_schema_version');
    expect(codeOf(() => parseTerms('{not json'))).toBe('invalid_terms_json');
    expect(codeOf(() => parseTerms('[1,2]'))).toBe('invalid_terms');
    expect(codeOf(() => parseTerms(undefined))).toBe('invalid_terms_json');
  });
});
