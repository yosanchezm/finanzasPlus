// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateCharges } from '../src/charges.js';
import { buildSchedule, summarizeSchedule } from '../src/schedule/index.js';
import { mulberry32 } from './helpers/prng.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/libranza-10m-15mv-24.json', import.meta.url), 'utf8'));

const charge = (overrides) => ({ kind: 'fee', label: 'x', cadence: 'per_installment', fromPeriod: 1, toPeriod: null, display: 'itemized', ...overrides });
const context = (overrides = {}) => ({
  period: 1,
  openingMinor: 10_000_000,
  installmentMinor: 400_000,
  originalMinor: 10_000_000,
  periodsPerYear: 12,
  unit: 1,
  ...overrides,
});
const amounts = (evaluation) => Object.fromEntries(evaluation.lines.map((line) => [line.id, line.amountMinor]));
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

describe('evaluateCharges: bases', () => {
  it('charges GMF 0.4% on a 400,000 subtotal: 1,600', () => {
    const gmf = charge({ id: 'gmf', kind: 'tax', basis: 'pctOfSubtotal', value: 0.4 });
    const result = evaluateCharges([gmf], context());
    expect(result.lines).toEqual([{ id: 'gmf', kind: 'tax', label: 'x', display: 'itemized', amountMinor: 1600 }]);
    expect(result.taxesMinor).toBe(1600);
    expect(result.chargesMinor).toBe(0);
  });

  it('charges IVA 19% on a 10,000 fixed fee: 1,900, and the pair is 11,900', () => {
    const fee = charge({ id: 'fee', basis: 'fixed', value: 10_000 });
    const iva = charge({ id: 'iva', kind: 'tax', basis: 'pctOfCharge', refId: 'fee', value: 19 });
    const result = evaluateCharges([fee, iva], context());
    expect(amounts(result)).toEqual({ fee: 10_000, iva: 1900 });
    expect(result.chargesMinor).toBe(10_000);
    expect(result.taxesMinor).toBe(1900);
    expect(result.chargesMinor + result.taxesMinor).toBe(11_900);
  });

  it('evaluates base, then pctOfCharge, then pctOfSubtotal regardless of the listed order', () => {
    const gmf = charge({ id: 'gmf', kind: 'tax', basis: 'pctOfSubtotal', value: 0.4 });
    const iva = charge({ id: 'iva', kind: 'tax', basis: 'pctOfCharge', refId: 'fee', value: 19 });
    const fee = charge({ id: 'fee', basis: 'fixed', value: 10_000 });
    const result = evaluateCharges([gmf, iva, fee], context());
    // GMF applies to the installment plus the fee and its IVA: 411,900 * 0.4% = 1,647.6
    expect(amounts(result)).toEqual({ gmf: 1648, iva: 1900, fee: 10_000 });
    expect(result.lines.map((line) => line.id)).toEqual(['gmf', 'iva', 'fee']);
  });

  it('computes the percentage bases from the opening balance, original principal and base amount', () => {
    const result = evaluateCharges(
      [
        charge({ id: 'out', kind: 'insurance', basis: 'pctOutstanding', value: 0.05 }),
        charge({ id: 'orig', kind: 'insurance', basis: 'pctOriginal', value: 0.02 }),
        charge({ id: 'base', kind: 'insurance', basis: 'pctOfBase', baseMinor: 80_000_000, value: 0.01 }),
      ],
      context({ openingMinor: 5_000_000 }),
    );
    expect(amounts(result)).toEqual({ out: 2500, orig: 2000, base: 8000 });
    expect(result.chargesMinor).toBe(12_500);
  });

  it('rounds each charge to the rounding unit but leaves fixed pesos exact', () => {
    const result = evaluateCharges(
      [
        charge({ id: 'out', kind: 'insurance', basis: 'pctOutstanding', value: 0.0517 }),
        charge({ id: 'fee', basis: 'fixed', value: 10_050 }),
      ],
      context({ unit: 100 }),
    );
    expect(amounts(result)).toEqual({ out: 5200, fee: 10_050 });
  });

  it('returns nothing for an empty charge list', () => {
    expect(evaluateCharges([], context())).toEqual({ lines: [], chargesMinor: 0, taxesMinor: 0 });
  });
});

describe('evaluateCharges: cadence and range', () => {
  const periodsWith = (definition, count, perYear = 12) => {
    const hits = [];
    for (let period = 1; period <= count; period += 1) {
      if (evaluateCharges([definition], context({ period, periodsPerYear: perYear })).lines.length > 0) hits.push(period);
    }
    return hits;
  };

  it('bills an annual insurance of 600,000 in periods 1 and 13 only on a 36-month schedule limited to 1-24', () => {
    const insurance = charge({ id: 'ins', kind: 'insurance', basis: 'fixed', value: 600_000, cadence: 'annual', fromPeriod: 1, toPeriod: 24 });
    expect(periodsWith(insurance, 36)).toEqual([1, 13]);
  });

  it('follows the periodicity for annual cadence and the fromPeriod anchor', () => {
    const quarterly = charge({ id: 'ins', basis: 'fixed', value: 1000, cadence: 'annual' });
    expect(periodsWith(quarterly, 10, 4)).toEqual([1, 5, 9]);
    const anchored = charge({ id: 'ins', basis: 'fixed', value: 1000, cadence: 'annual', fromPeriod: 4 });
    expect(periodsWith(anchored, 30)).toEqual([4, 16, 28]);
  });

  it('bills a once charge only in its first period', () => {
    expect(periodsWith(charge({ id: 'open', basis: 'fixed', value: 5000, cadence: 'once' }), 6)).toEqual([1]);
    expect(periodsWith(charge({ id: 'open', basis: 'fixed', value: 5000, cadence: 'once', fromPeriod: 3 }), 6)).toEqual([3]);
  });

  it('honours the period range of per-installment charges', () => {
    expect(periodsWith(charge({ id: 'r', basis: 'fixed', value: 1, fromPeriod: 3, toPeriod: 5 }), 8)).toEqual([3, 4, 5]);
    expect(periodsWith(charge({ id: 'r', basis: 'fixed', value: 1, fromPeriod: 6 }), 8)).toEqual([6, 7, 8]);
  });

  it('skips a pctOfCharge whose referenced charge is not billed that period', () => {
    const fee = charge({ id: 'fee', basis: 'fixed', value: 10_000, cadence: 'annual' });
    const iva = charge({ id: 'iva', kind: 'tax', basis: 'pctOfCharge', refId: 'fee', value: 19 });
    expect(amounts(evaluateCharges([fee, iva], context({ period: 1 })))).toEqual({ fee: 10_000, iva: 1900 });
    expect(evaluateCharges([fee, iva], context({ period: 2 })).lines).toEqual([]);
  });
});

describe('charges inside schedules', () => {
  const libranza = fixture.terms;

  it('matches the libranza golden rows to the peso', () => {
    const rows = buildSchedule(libranza);
    expect(rows).toHaveLength(24);
    for (const [period, expected] of Object.entries(fixture.rows)) {
      const { lines, ...figures } = expected;
      const row = rows[Number(period) - 1];
      expect(row).toMatchObject(figures);
      expect(amounts({ lines: row.charges })).toEqual(lines);
    }
  });

  it('keeps taxes apart from charges: IVA and GMF in taxesMinor, insurance and fee in chargesMinor', () => {
    const [row] = buildSchedule(libranza);
    expect(row.charges.map((line) => [line.id, line.kind])).toEqual([
      ['life', 'insurance'],
      ['fee', 'fee'],
      ['iva', 'tax'],
      ['gmf', 'tax'],
    ]);
    expect(row.chargesMinor).toBe(15_000);
    expect(row.taxesMinor).toBe(3965);
    expect(row.totalDueMinor).toBe(row.installmentMinor + row.chargesMinor + row.taxesMinor);
    expect(row.costMinor).toBe(row.interestMinor + row.chargesMinor + row.taxesMinor);
  });

  it('never changes principal amortization: the amortization columns match the schedule without charges', () => {
    const withCharges = buildSchedule(libranza);
    const without = buildSchedule({ ...libranza, charges: [] });
    const amortization = (rows) => rows.map(({ period, dueOn, openingMinor, interestMinor, principalMinor, installmentMinor, closingMinor }) => ({ period, dueOn, openingMinor, interestMinor, principalMinor, installmentMinor, closingMinor }));
    expect(amortization(withCharges)).toEqual(amortization(without));
    expect(without.every((row) => row.chargesMinor === 0 && row.totalDueMinor === row.installmentMinor)).toBe(true);
  });

  it('bills the annual insurance of a 36-month schedule only in periods 1 and 13', () => {
    const insurance = { id: 'ins', kind: 'insurance', label: 'Seguro anual', basis: 'fixed', value: 600_000, cadence: 'annual', fromPeriod: 1, toPeriod: 24 };
    const rows = buildSchedule({ ...libranza, n: 36, charges: [insurance] });
    const billed = rows.filter((row) => row.charges.length > 0).map((row) => row.period);
    expect(billed).toEqual([1, 13]);
    expect(rows[0].chargesMinor).toBe(600_000);
    expect(rows[1].chargesMinor).toBe(0);
  });

  it('gives bundled and itemized presentation identical totals', () => {
    const asDisplay = (display) => ({ ...libranza, charges: libranza.charges.map((item) => ({ ...item, display })) });
    const bundled = buildSchedule(asDisplay('bundled'));
    const itemized = buildSchedule(asDisplay('itemized'));
    expect(bundled.map((row) => row.totalDueMinor)).toEqual(itemized.map((row) => row.totalDueMinor));
    expect(bundled[0].charges.every((line) => line.display === 'bundled')).toBe(true);
    expect(itemized[0].charges.every((line) => line.display === 'itemized')).toBe(true);
    expect(bundled[0].totalDueMinor).toBe(bundled[0].principalMinor + bundled[0].interestMinor + bundled[0].chargesMinor + bundled[0].taxesMinor);
  });

  it('still bills charges during total grace, when the installment itself is 0', () => {
    const rows = buildSchedule({ ...libranza, grace: { periods: 2, type: 'total' } });
    expect(rows[0].installmentMinor).toBe(0);
    expect(rows[0].totalDueMinor).toBe(rows[0].chargesMinor + rows[0].taxesMinor);
    expect(rows[0].totalDueMinor).toBeGreaterThan(0);
    expect(rows[0].charges.map((line) => line.id)).toEqual(['life', 'fee', 'iva', 'gmf']);
  });
});

describe('summarizeSchedule', () => {
  it('reports the libranza totals separately from principal', () => {
    expect(summarizeSchedule(buildSchedule(fixture.terms))).toEqual({
      count: 24,
      costMinor: fixture.totals.interestMinor + fixture.totals.chargesMinor + fixture.totals.taxesMinor,
      ...fixture.totals,
    });
  });

  it('summarizes an empty schedule as zeros', () => {
    expect(summarizeSchedule([])).toEqual({
      count: 0,
      principalMinor: 0,
      interestMinor: 0,
      chargesMinor: 0,
      taxesMinor: 0,
      installmentsMinor: 0,
      totalDueMinor: 0,
      costMinor: 0,
    });
  });

  it('reconciles over 200 seeded schedules: installments = principal + interest and total due adds charges and taxes', () => {
    const random = mulberry32(777);
    const pick = (list) => list[Math.floor(random() * list.length)];
    let withCharges = 0;
    for (let caseNumber = 0; caseNumber < 200; caseNumber += 1) {
      const principalMinor = 200_000 + Math.floor(random() * 40_000_000);
      const charges = [];
      if (random() < 0.7) charges.push({ id: 'life', kind: 'insurance', basis: 'pctOutstanding', value: Math.round(random() * 100) / 1000 });
      if (random() < 0.6) {
        charges.push({ id: 'fee', kind: 'fee', basis: 'fixed', value: Math.floor(random() * 30_000), cadence: pick(['per_installment', 'annual', 'once']) });
        if (random() < 0.7) charges.push({ id: 'iva', kind: 'tax', basis: 'pctOfCharge', refId: 'fee', value: 19 });
      }
      if (random() < 0.5) charges.push({ id: 'gmf', kind: 'tax', basis: 'pctOfSubtotal', value: 0.4 });
      if (charges.length > 0) withCharges += 1;
      const terms = {
        ...fixture.terms,
        principalMinor,
        system: pick(['french', 'german', 'bullet', 'interest_only']),
        rate: { value: Math.round(random() * 5000) / 100, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
        n: 1 + Math.floor(random() * 48),
        roundingUnit: random() < 0.3 ? 100 : 1,
        charges,
      };
      const rows = buildSchedule(terms);
      const summary = summarizeSchedule(rows);
      const label = `case ${caseNumber} (${terms.system})`;
      expect(summary.principalMinor, label).toBe(principalMinor);
      expect(summary.installmentsMinor, label).toBe(summary.principalMinor + summary.interestMinor);
      expect(summary.totalDueMinor, label).toBe(summary.principalMinor + summary.interestMinor + summary.chargesMinor + summary.taxesMinor);
      for (const row of rows) {
        expect(Math.abs(row.totalDueMinor - (row.principalMinor + row.interestMinor + row.chargesMinor + row.taxesMinor)), label).toBeLessThanOrEqual(1);
        expect(row.chargesMinor, label).toBe(sum(row.charges.filter((line) => line.kind !== 'tax'), 'amountMinor'));
        expect(row.taxesMinor, label).toBe(sum(row.charges.filter((line) => line.kind === 'tax'), 'amountMinor'));
      }
      expect(sum(rows, 'principalMinor'), label).toBe(sum(buildSchedule({ ...terms, charges: [] }), 'principalMinor'));
    }
    expect(withCharges).toBeGreaterThan(150);
  });
});
