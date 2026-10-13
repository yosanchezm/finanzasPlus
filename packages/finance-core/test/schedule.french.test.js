// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.js';
import { buildSchedule } from '../src/schedule/index.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/french-10m-24ea-36.json', import.meta.url), 'utf8'));

const french = (overrides = {}) => ({ ...fixture.terms, ...overrides });
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

describe('French system: canonical 10,000,000 at 24% EA over 36 months', () => {
  const rows = buildSchedule(french());

  it('produces 36 numbered rows with monthly due dates', () => {
    expect(rows).toHaveLength(36);
    expect(rows.map((row) => row.period)).toEqual(Array.from({ length: 36 }, (_, index) => index + 1));
    expect(rows[0].dueOn).toBe('2026-02-15');
    expect(rows[35].dueOn).toBe('2029-01-15');
  });

  it('matches the spec figures: interest about 180,876 and installment 380,381 (+/-1)', () => {
    expect(Math.abs(rows[0].interestMinor - 180876)).toBeLessThanOrEqual(1);
    expect(Math.abs(rows[0].installmentMinor - 380381)).toBeLessThanOrEqual(1);
    expect(rows[0].principalMinor).toBe(199505);
  });

  it('keeps installments 1-35 equal and the last within 36 pesos', () => {
    const first = rows[0].installmentMinor;
    expect(rows.slice(0, 35).every((row) => row.installmentMinor === first)).toBe(true);
    expect(Math.abs(rows[35].installmentMinor - first)).toBeLessThanOrEqual(36);
  });

  it('amortizes exactly: principal sums to P and the closing balance is 0', () => {
    expect(sum(rows, 'principalMinor')).toBe(10_000_000);
    expect(rows[35].closingMinor).toBe(0);
    expect(rows.every((row) => Number.isInteger(row.interestMinor) && Number.isInteger(row.principalMinor))).toBe(true);
    expect(rows.every((row, index) => row.openingMinor === (index === 0 ? 10_000_000 : rows[index - 1].closingMinor))).toBe(true);
    expect(rows.every((row) => row.closingMinor === row.openingMinor - row.principalMinor)).toBe(true);
  });

  it('matches the golden fixture row by row', () => {
    for (const [period, expected] of Object.entries(fixture.rows)) {
      expect(rows[Number(period) - 1]).toMatchObject({ period: Number(period), ...expected });
    }
    expect(sum(rows, 'interestMinor')).toBe(fixture.totals.interestMinor);
    expect(sum(rows, 'installmentMinor')).toBe(fixture.totals.installmentsMinor);
  });

  it('starts every row with no charges: total due equals the installment', () => {
    expect(rows[0]).toMatchObject({ charges: [], chargesMinor: 0, taxesMinor: 0, totalDueMinor: 380381, costMinor: 180876 });
  });
});

describe('French system: other inputs', () => {
  it('is interest-free at 0%: 1,200,000 over 12 gives 100,000 each', () => {
    const rows = buildSchedule(french({ principalMinor: 1_200_000, rate: { convention: 'ZERO' }, n: 12 }));
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.installmentMinor === 100_000 && row.interestMinor === 0)).toBe(true);
    expect(rows[11].closingMinor).toBe(0);
  });

  it('compounds a quarterly schedule with its own periodic rate', () => {
    const rows = buildSchedule(
      french({
        principalMinor: 4_000_000,
        rate: { value: 12, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
        periodicity: 'quarterly',
        n: 8,
      }),
    );
    expect(rows).toHaveLength(8);
    expect(rows[0].interestMinor).toBe(Math.round(4_000_000 * (1.12 ** 0.25 - 1)));
    expect(rows[1].dueOn).toBe('2026-05-15');
    expect(sum(rows, 'principalMinor')).toBe(4_000_000);
    expect(rows[7].closingMinor).toBe(0);
  });

  it('honours an anticipated monthly rate (i = 0.02 / 0.98)', () => {
    const rows = buildSchedule(
      french({ principalMinor: 5_000_000, rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'advance' }, n: 6 }),
    );
    expect(rows[0].interestMinor).toBe(Math.round((5_000_000 * 0.02) / 0.98));
    expect(sum(rows, 'principalMinor')).toBe(5_000_000);
  });

  it('rounds every component to the rounding unit and still closes at 0', () => {
    const rows = buildSchedule(french({ principalMinor: 3_000_000, roundingUnit: 100, n: 12 }));
    expect(rows.slice(0, 11).every((row) => row.interestMinor % 100 === 0 && row.installmentMinor % 100 === 0)).toBe(true);
    expect(sum(rows, 'principalMinor')).toBe(3_000_000);
    expect(rows[11].closingMinor).toBe(0);
  });

  it('keeps month-end due dates anchored on dueDay', () => {
    const rows = buildSchedule(french({ firstDueOn: '2026-01-31', dueDay: 31, n: 4 }));
    expect(rows.map((row) => row.dueOn)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('handles a single-installment loan', () => {
    const [row] = buildSchedule(french({ principalMinor: 1_000_000, n: 1 }));
    expect(row.principalMinor).toBe(1_000_000);
    expect(row.closingMinor).toBe(0);
    expect(row.interestMinor).toBe(Math.round(1_000_000 * 0.018087582483510722));
  });
});

describe('buildSchedule options', () => {
  it('rebuilds the tail from fromPeriod and balanceMinor on the original calendar', () => {
    const rows = buildSchedule(french(), { fromPeriod: 13, balanceMinor: 6_000_000 });
    expect(rows).toHaveLength(24);
    expect(rows[0]).toMatchObject({ period: 13, dueOn: '2027-02-15', openingMinor: 6_000_000 });
    expect(rows[23].period).toBe(36);
    expect(sum(rows, 'principalMinor')).toBe(6_000_000);
    expect(rows[23].closingMinor).toBe(0);
  });

  it('lets startDate move the first rebuilt due date', () => {
    const rows = buildSchedule(french(), { fromPeriod: 13, balanceMinor: 6_000_000, startDate: '2027-03-01' });
    expect(rows[0].dueOn).toBe('2027-03-01');
    expect(rows[1].dueOn).toBe('2027-04-01');
  });

  it('returns no rows for a balance-only debt', () => {
    const terms = { kind: 'informal', principalMinor: 500_000, openedOn: '2026-03-01', rate: { convention: 'ZERO' }, system: 'none' };
    expect(buildSchedule(terms)).toEqual([]);
  });

  it('rejects invalid terms and invalid options with a typed error', () => {
    expect(() => buildSchedule(french({ principalMinor: -5 }))).toThrow(ValidationError);
    expect(() => buildSchedule(french(), { fromPeriod: 0 })).toThrow(ValidationError);
    expect(() => buildSchedule(french(), { fromPeriod: 37 })).toThrow(ValidationError);
    expect(() => buildSchedule(french(), { balanceMinor: -1 })).toThrow(ValidationError);
    expect(() => buildSchedule(french(), { startDate: '2027-13-01' })).toThrow(ValidationError);
  });
});

describe('buildSchedule installmentMinor (keep the installment, let the term float)', () => {
  const installment = 380_381;

  it('clears a smaller balance in fewer installments of the same amount, the last one smaller', () => {
    const rows = buildSchedule(french(), { fromPeriod: 13, balanceMinor: 6_000_000, installmentMinor: installment });
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.length).toBeLessThan(24);
    expect(rows.slice(0, -1).every((row) => row.installmentMinor === installment)).toBe(true);
    expect(rows[rows.length - 1].installmentMinor).toBeLessThanOrEqual(installment);
    expect(rows[0]).toMatchObject({ period: 13, dueOn: '2027-02-15', openingMinor: 6_000_000 });
    expect(rows[rows.length - 1].period).toBe(12 + rows.length);
    expect(sum(rows, 'principalMinor')).toBe(6_000_000);
    expect(rows[rows.length - 1].closingMinor).toBe(0);
  });

  it('runs past the original term when the balance needs more installments, on the same calendar', () => {
    const rows = buildSchedule(french({ rate: { value: 40, basis: 'effective', periodicity: 'annual', timing: 'arrears' } }), {
      fromPeriod: 25,
      balanceMinor: 8_000_000,
      installmentMinor: installment,
    });
    expect(rows.length).toBeGreaterThan(12);
    expect(rows[0].dueOn).toBe('2028-02-15');
    expect(rows[12].dueOn).toBe('2029-02-15');
    expect(rows[rows.length - 1].closingMinor).toBe(0);
  });

  it('is exact at 0%: 800,000 at 100,000 is eight installments', () => {
    const zero = french({ principalMinor: 1_200_000, n: 12, rate: { convention: 'ZERO' } });
    const rows = buildSchedule(zero, { fromPeriod: 2, balanceMinor: 800_000, installmentMinor: 100_000 });
    expect(rows.map((row) => row.installmentMinor)).toEqual(Array(8).fill(100_000));
    expect(buildSchedule(zero, { fromPeriod: 2, balanceMinor: 750_000, installmentMinor: 100_000 }).map((row) => row.principalMinor)).toEqual([
      100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 50_000,
    ]);
  });

  it('applies the terms charges to the rebuilt rows', () => {
    const fee = { id: 'fee', kind: 'fee', basis: 'fixed', value: 10_000 };
    const rows = buildSchedule(french({ charges: [fee] }), { fromPeriod: 13, balanceMinor: 6_000_000, installmentMinor: installment });
    expect(rows.length).toBeLessThan(24);
    expect(rows.every((row) => row.chargesMinor === 10_000 && row.totalDueMinor === row.installmentMinor + 10_000)).toBe(true);
  });

  it('rejects an installment that cannot amortize the balance and invalid usage', () => {
    const codeOf = (options, terms = french()) => {
      try {
        buildSchedule(terms, options);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        return error.code;
      }
      return 'no error';
    };
    expect(codeOf({ balanceMinor: 10_000_000, installmentMinor: 100_000 })).toBe('installment_too_low');
    expect(codeOf({ installmentMinor: 0 })).toBe('invalid_option');
    expect(codeOf({ installmentMinor: 1.5 })).toBe('invalid_option');
    expect(codeOf({ installmentMinor: 100_000 }, french({ system: 'german' }))).toBe('invalid_option');
  });
});
