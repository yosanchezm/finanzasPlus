// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors.js';
import { periodicRate } from '../src/rates.js';
import { buildSchedule } from '../src/schedule/index.js';
import { mulberry32 } from './helpers/prng.js';

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });

const terms = (overrides = {}) => ({
  kind: 'consumer',
  principalMinor: 1_200_000,
  openedOn: '2026-01-15',
  rate: EA(18),
  system: 'german',
  periodicity: 'monthly',
  n: 12,
  firstDueOn: '2026-02-15',
  ...overrides,
});

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const monthlyRate = (percent) => 1 + percent / 100;

describe('German system', () => {
  it('amortizes 1,200,000 over 12 with 100,000 principal and falling interest and total', () => {
    const rows = buildSchedule(terms());
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => Math.abs(row.principalMinor - 100_000) <= 1)).toBe(true);
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index].interestMinor).toBeLessThanOrEqual(rows[index - 1].interestMinor);
      expect(rows[index].installmentMinor).toBeLessThanOrEqual(rows[index - 1].installmentMinor);
    }
    expect(rows[0].interestMinor).toBeGreaterThan(rows[11].interestMinor);
    expect(rows[0].interestMinor).toBe(Math.round(1_200_000 * (monthlyRate(18) ** (1 / 12) - 1)));
    expect(sum(rows, 'principalMinor')).toBe(1_200_000);
    expect(rows[11].closingMinor).toBe(0);
  });

  it('gives the rounding residue to the last row when P does not divide by n', () => {
    const rows = buildSchedule(terms({ principalMinor: 1_000_000, n: 7 }));
    expect(rows.slice(0, 6).every((row) => row.principalMinor === 142_857)).toBe(true);
    expect(rows[6].principalMinor).toBe(1_000_000 - 6 * 142_857);
    expect(rows[6].closingMinor).toBe(0);
  });
});

describe('bullet system', () => {
  it('pays everything at maturity: interest capitalizes until the last row', () => {
    const rows = buildSchedule(terms({ system: 'bullet', principalMinor: 3_000_000, rate: EA(12), n: 3 }));
    const i = 1.12 ** (1 / 12) - 1;
    const cap1 = Math.round(3_000_000 * i);
    const cap2 = Math.round((3_000_000 + cap1) * i);
    expect(rows[0]).toMatchObject({ interestMinor: cap1, principalMinor: -cap1, installmentMinor: 0, closingMinor: 3_000_000 + cap1 });
    expect(rows[1]).toMatchObject({ openingMinor: 3_000_000 + cap1, installmentMinor: 0, closingMinor: 3_000_000 + cap1 + cap2 });
    expect(rows[2].principalMinor).toBe(3_000_000 + cap1 + cap2);
    expect(rows[2].closingMinor).toBe(0);
    expect(sum(rows, 'principalMinor')).toBe(3_000_000);
    expect(sum(rows, 'installmentMinor')).toBe(3_000_000 + sum(rows, 'interestMinor'));
  });

  it('is a single payment of principal plus interest when n is 1, and principal only at 0%', () => {
    const [single] = buildSchedule(terms({ system: 'bullet', principalMinor: 2_000_000, rate: EA(12), n: 1 }));
    expect(single.principalMinor).toBe(2_000_000);
    expect(single.installmentMinor).toBe(2_000_000 + single.interestMinor);
    const free = buildSchedule(terms({ system: 'bullet', principalMinor: 2_000_000, rate: { convention: 'ZERO' }, n: 4 }));
    expect(free.map((row) => row.installmentMinor)).toEqual([0, 0, 0, 2_000_000]);
  });
});

describe('interest-only system', () => {
  it('pays only interest and returns the balloon in the last row', () => {
    const rows = buildSchedule(terms({ system: 'interest_only', principalMinor: 5_000_000, balloonMinor: 5_000_000, n: 6 }));
    expect(rows.slice(0, 5).every((row) => row.principalMinor === 0 && row.installmentMinor === row.interestMinor)).toBe(true);
    expect(rows[0].interestMinor).toBe(Math.round(5_000_000 * (1.18 ** (1 / 12) - 1)));
    expect(rows[5].principalMinor).toBe(5_000_000);
    expect(rows[5].closingMinor).toBe(0);
  });

  it('treats a missing balloon as the whole principal', () => {
    const rows = buildSchedule(terms({ system: 'interest_only', principalMinor: 5_000_000, n: 4 }));
    expect(rows[3].principalMinor).toBe(5_000_000);
    expect(sum(rows, 'principalMinor')).toBe(5_000_000);
  });

  it('amortizes the part above the balloon first, leaving exactly the balloon for the last row', () => {
    const rows = buildSchedule(terms({ system: 'interest_only', principalMinor: 20_000_000, balloonMinor: 5_000_000, n: 12 }));
    expect(rows[10].closingMinor).toBe(5_000_000);
    expect(rows[11].principalMinor).toBe(5_000_000);
    expect(rows[11].closingMinor).toBe(0);
    expect(rows[0].principalMinor).toBe(1_363_636);
    expect(rows[9].principalMinor).toBe(1_363_636);
    expect(rows[10].principalMinor).toBe(15_000_000 - 10 * 1_363_636);
    expect(sum(rows, 'principalMinor')).toBe(20_000_000);
  });
});

describe('manual system', () => {
  const manual = (overrides = {}) =>
    terms({
      system: 'manual',
      principalMinor: 1_000_000,
      rate: { convention: 'ZERO' },
      n: undefined,
      firstDueOn: undefined,
      manualPlan: [
        ['2026-03-01', 300_000],
        ['2026-04-10', 300_000],
        ['2026-05-20', 100_000],
      ],
      ...overrides,
    });

  it('follows the planned dates and amounts and settles the remainder in the last row', () => {
    const rows = buildSchedule(manual());
    expect(rows.map((row) => row.dueOn)).toEqual(['2026-03-01', '2026-04-10', '2026-05-20']);
    expect(rows.map((row) => row.installmentMinor)).toEqual([300_000, 300_000, 400_000]);
    expect(sum(rows, 'principalMinor')).toBe(1_000_000);
    expect(rows[2].closingMinor).toBe(0);
  });

  it('never amortizes more than the balance when the plan overshoots', () => {
    const rows = buildSchedule(manual({ manualPlan: [['2026-03-01', 700_000], ['2026-04-01', 700_000], ['2026-05-01', 700_000]] }));
    expect(rows.map((row) => row.principalMinor)).toEqual([700_000, 300_000, 0]);
    expect(rows.every((row) => row.closingMinor >= 0)).toBe(true);
  });

  it('charges interest on the balance and splits each planned amount', () => {
    const rows = buildSchedule(manual({ rate: EA(24), manualPlan: [['2026-03-01', 400_000], ['2026-04-01', 400_000]] }));
    const i = periodicRate(EA(24), 'monthly');
    expect(rows[0].interestMinor).toBe(Math.round(1_000_000 * i));
    expect(rows[0].principalMinor).toBe(400_000 - rows[0].interestMinor);
    expect(rows[0].installmentMinor).toBe(400_000);
    expect(sum(rows, 'principalMinor')).toBe(1_000_000);
    expect(rows[1].closingMinor).toBe(0);
  });

  it('ignores startDate because manual dates are explicit', () => {
    const rows = buildSchedule(manual(), { startDate: '2030-01-01' });
    expect(rows[0].dueOn).toBe('2026-03-01');
  });

  it('rejects a planned amount that does not cover the accrued interest', () => {
    let failure = null;
    try {
      buildSchedule(manual({ rate: EA(60), manualPlan: [['2026-03-01', 10_000], ['2026-04-01', 10_000]] }));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure.code).toBe('manual_plan_below_interest');
  });

  it('rebuilds from a later period using the remaining plan entries', () => {
    const rows = buildSchedule(manual(), { fromPeriod: 2, balanceMinor: 700_000 });
    expect(rows.map((row) => row.period)).toEqual([2, 3]);
    expect(rows[0].dueOn).toBe('2026-04-10');
    expect(sum(rows, 'principalMinor')).toBe(700_000);
  });
});

describe('grace periods', () => {
  it('capitalizes interest during total grace: balance exceeds P and the final balance is 0', () => {
    const rows = buildSchedule(terms({ system: 'french', principalMinor: 6_000_000, grace: { periods: 2, type: 'total' } }));
    const i = 1.18 ** (1 / 12) - 1;
    const cap1 = Math.round(6_000_000 * i);
    const cap2 = Math.round((6_000_000 + cap1) * i);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ interestMinor: cap1, principalMinor: -cap1, installmentMinor: 0 });
    expect(rows[1]).toMatchObject({ interestMinor: cap2, installmentMinor: 0, closingMinor: 6_000_000 + cap1 + cap2 });
    expect(rows[2].openingMinor).toBe(6_000_000 + cap1 + cap2);
    expect(rows[2].openingMinor).toBeGreaterThan(6_000_000);
    expect(rows[2].installmentMinor).toBeGreaterThan(0);
    expect(sum(rows, 'principalMinor')).toBe(6_000_000);
    expect(rows[11].closingMinor).toBe(0);
  });

  it('keeps paying interest during principal-only grace, with no principal', () => {
    const rows = buildSchedule(terms({ system: 'french', principalMinor: 6_000_000, grace: { periods: 3, type: 'principal' } }));
    expect(rows).toHaveLength(12);
    for (const row of rows.slice(0, 3)) {
      expect(row.principalMinor).toBe(0);
      expect(row.interestMinor).toBeGreaterThan(0);
      expect(row.installmentMinor).toBe(row.interestMinor);
      expect(row.closingMinor).toBe(6_000_000);
    }
    expect(rows[3].principalMinor).toBeGreaterThan(0);
    expect(sum(rows, 'principalMinor')).toBe(6_000_000);
    expect(rows[11].closingMinor).toBe(0);
  });

  it('applies to the German system too, amortizing the post-grace balance evenly', () => {
    const rows = buildSchedule(terms({ system: 'german', principalMinor: 1_200_000, grace: { periods: 3, type: 'principal' } }));
    expect(rows.slice(0, 3).every((row) => row.principalMinor === 0)).toBe(true);
    expect(rows.slice(3, 11).every((row) => row.principalMinor === 133_333)).toBe(true);
    expect(rows[11].principalMinor).toBe(1_200_000 - 8 * 133_333);
    expect(rows[11].closingMinor).toBe(0);
  });

  it('adds nothing at 0%: grace rows are listed with zero interest', () => {
    const total = buildSchedule(terms({ system: 'french', rate: { convention: 'ZERO' }, grace: { periods: 2, type: 'total' } }));
    expect(total.slice(0, 2).every((row) => row.interestMinor === 0 && row.principalMinor === 0 && row.installmentMinor === 0)).toBe(true);
    expect(total[2].openingMinor).toBe(1_200_000);
    expect(total[2].installmentMinor).toBe(120_000);
  });

  it('counts grace on absolute period numbers when a schedule is rebuilt', () => {
    const rows = buildSchedule(terms({ system: 'french', principalMinor: 6_000_000, grace: { periods: 2, type: 'total' } }), {
      fromPeriod: 2,
      balanceMinor: 6_100_000,
    });
    expect(rows).toHaveLength(11);
    expect(rows[0]).toMatchObject({ period: 2, installmentMinor: 0 });
    expect(rows[0].closingMinor).toBeGreaterThan(6_100_000);
    expect(rows[1].period).toBe(3);
    expect(rows[1].installmentMinor).toBeGreaterThan(0);
    expect(rows[10].closingMinor).toBe(0);
  });
});

describe('property: every system amortizes exactly (200 seeded cases)', () => {
  const PERIODICITIES = ['weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'];
  const SYSTEMS = ['french', 'german', 'bullet', 'interest_only', 'manual'];

  it('principal sums to P, the final balance is 0 and amounts are whole numbers', () => {
    const random = mulberry32(20261012);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const seen = {};
    for (let caseNumber = 0; caseNumber < 200; caseNumber += 1) {
      const system = SYSTEMS[caseNumber % SYSTEMS.length];
      const periodicity = pick(PERIODICITIES);
      const principalMinor = 100_000 + Math.floor(random() * 50_000_000);
      const rate = random() < 0.1 ? { convention: 'ZERO' } : EA(Math.round(random() * 6000) / 100);
      const n = 1 + Math.floor(random() * 60);
      const roundingUnit = random() < 0.3 ? 100 : 1;
      const candidate = terms({ system, periodicity, principalMinor, rate, n, roundingUnit });
      let capitalizingUntil = 0;
      if ((system === 'french' || system === 'german') && n > 2 && random() < 0.5) {
        const type = random() < 0.5 ? 'total' : 'principal';
        candidate.grace = { periods: 1 + Math.floor(random() * Math.min(5, n - 1)), type };
        if (type === 'total') capitalizingUntil = candidate.grace.periods;
      }
      if (system === 'interest_only' && n > 1 && random() < 0.5) {
        candidate.balloonMinor = Math.max(1, Math.floor(principalMinor * random()));
      }
      if (system === 'manual') {
        const i = periodicRate(rate, periodicity);
        const count = 1 + Math.floor(random() * 12);
        candidate.manualPlan = Array.from({ length: count }, (_, index) => [
          `${2026 + Math.floor((index + 2) / 12)}-${String(((index + 2) % 12) + 1).padStart(2, '0')}-01`,
          Math.ceil(principalMinor * (i + 0.02 + random() * 0.2)),
        ]);
        delete candidate.n;
        delete candidate.firstDueOn;
      }

      const rows = buildSchedule(candidate);
      const label = `${system} case ${caseNumber}`;
      expect(sum(rows, 'principalMinor'), label).toBe(principalMinor);
      expect(rows[rows.length - 1].closingMinor, label).toBe(0);
      for (const row of rows) {
        const whole = [row.openingMinor, row.interestMinor, row.principalMinor, row.installmentMinor, row.closingMinor];
        expect(whole.every(Number.isSafeInteger), label).toBe(true);
        expect(row.openingMinor, label).toBeGreaterThanOrEqual(0);
        expect(row.closingMinor, label).toBeGreaterThanOrEqual(0);
        expect(row.interestMinor, label).toBeGreaterThanOrEqual(0);
        expect(row.installmentMinor, label).toBeGreaterThanOrEqual(0);
        if (system !== 'bullet' && row.period > capitalizingUntil) expect(row.principalMinor, label).toBeGreaterThanOrEqual(0);
      }
      seen[system] = (seen[system] ?? 0) + 1;
    }
    expect(seen).toEqual({ french: 40, german: 40, bullet: 40, interest_only: 40, manual: 40 });
  });
});
