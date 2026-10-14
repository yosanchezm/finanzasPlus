// @vitest-environment node
import { project } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { DAY_10, MORA_DISBURSEMENT, makeMoraLoan, usuryLegal } from './debtFixtures';
import { defaultLateDraft } from './lateModel';
import { describeLate, initialLateForm, previewLatePolicy } from './latePolicyModel';

// The reference loan: first installment 390,381 due 2026-02-05 (principal 199,505). A policy effective on the due date
// accrues from 2026-02-06, so on 2026-02-15 (10 days later) the mora at the 28.59% EA cap is 1,375.
const DUE_DAY = '2026-02-05';
const FIXED_RATE = { basis: 'effective', periodicity: 'annual', timing: 'arrears' };

const formWith = (effectiveOn, patch = {}) => ({ effectiveOn, late: { ...defaultLateDraft('consumer'), ...patch } });
const preview = ({ form, late = null, legal, today = DAY_10, events = [MORA_DISBURSEMENT] }) => {
  const debt = legal ? makeMoraLoan({ late, legal }) : makeMoraLoan({ late });
  return previewLatePolicy({ debt, events, projection: project(debt, events, today), form, today });
};

describe('initialLateForm', () => {
  it('starts on today with the policy in force: none for a debt that never had one', () => {
    const debt = makeMoraLoan({ late: null });
    const form = initialLateForm(project(debt, [MORA_DISBURSEMENT], DAY_10), DAY_10);

    expect(form.effectiveOn).toBe(DAY_10);
    expect(form.late).toMatchObject({ mode: 'none', graceDays: '0' });
  });

  it('starts from the policy in force, as the strings the inputs hold', () => {
    const debt = makeMoraLoan({ late: { mode: 'fixed', graceDays: 4, rate: { value: 20, ...FIXED_RATE } } });
    const form = initialLateForm(project(debt, [MORA_DISBURSEMENT], DAY_10), DAY_10);

    expect(form.late).toMatchObject({ mode: 'fixed', graceDays: '4', rate: { value: '20' } });
  });
});

describe('previewLatePolicy: usury effective 10 days ago', () => {
  const result = preview({ form: formWith(DUE_DAY) });

  it('previews the golden mora of 1,375 on principal 199,505 and the overdue total with it', () => {
    expect(result.issue).toBeNull();
    expect(result.before).toMatchObject({ lateInterestMinor: 0, pastDueMinor: 390381 });
    expect(result.after).toMatchObject({ lateInterestMinor: 1375, pastDueMinor: 391756 });
    expect(result.asOf).toBe(DAY_10);
  });

  it('builds the late_policy draft to save and flags the date as backdated', () => {
    expect(result.draft).toEqual({ kind: 'late_policy', effectiveOn: DUE_DAY, late: { mode: 'usury', graceDays: 0 } });
    expect(result.backdated).toBe(true);
  });

  it('shows the annual rate in force before and after, and the cap that applies', () => {
    expect(result.rates.before).toBeNull();
    expect(result.rates.after).toBeCloseTo(28.59, 6);
    expect(result.capEA).toBeCloseTo(28.59, 6);
  });
});

describe('previewLatePolicy: other dates and modes', () => {
  it('effective today shows no mora, keeps every payment cost and is not backdated', () => {
    const result = preview({ form: formWith(DAY_10) });

    expect(result.after.lateInterestMinor).toBe(0);
    expect(result.before.lateInterestMinor).toBe(0);
    expect(result.draft.effectiveOn).toBe(DAY_10);
    expect(result.backdated).toBe(false);
    expect(result.impacted).toEqual([]);
  });

  it('measures a future policy on its own date, where the first accruing day is the day after', () => {
    const result = preview({ form: formWith('2026-02-20') });

    expect(result.asOf).toBe('2026-02-20');
    expect(result.after.lateInterestMinor).toBe(0);
  });

  it('grace days delay the first accruing day: 3 grace days leave 7 days of mora (962)', () => {
    const result = preview({ form: formWith(DUE_DAY, { graceDays: '3' }) });

    expect(result.draft.late).toEqual({ mode: 'usury', graceDays: 3 });
    expect(result.after.lateInterestMinor).toBe(962);
  });

  it('a fixed rate under the cap is used as stated: 20% EA gives 997', () => {
    const result = preview({ form: formWith(DUE_DAY, { mode: 'fixed', rate: { value: '20', ...FIXED_RATE } }) });

    expect(result.draft.late).toEqual({ mode: 'fixed', graceDays: 0, rate: { value: 20, ...FIXED_RATE } });
    expect(result.after.lateInterestMinor).toBe(997);
    expect(result.rates.after).toBeCloseTo(20, 6);
  });

  it('a fixed rate above the cap is capped: 36% EA still gives 1,375', () => {
    const result = preview({ form: formWith(DUE_DAY, { mode: 'fixed', rate: { value: '36', ...FIXED_RATE } }) });

    expect(result.after.lateInterestMinor).toBe(1375);
    expect(result.rates.after).toBeCloseTo(28.59, 6);
  });

  it('a multiple of the contract rate: 1 x 24% gives 1,176 and 1.5 x 24% is capped to 1,375', () => {
    expect(preview({ form: formWith(DUE_DAY, { mode: 'contract_multiple', multiple: '1' }) }).after.lateInterestMinor).toBe(1176);
    const capped = preview({ form: formWith(DUE_DAY, { mode: 'contract_multiple', multiple: '1.5' }) });
    expect(capped.draft.late).toEqual({ mode: 'contract_multiple', graceDays: 0, multiple: 1.5 });
    expect(capped.after.lateInterestMinor).toBe(1375);
  });

  it('turning mora off previews 0 and compares against the policy in force', () => {
    const result = preview({ late: { mode: 'usury', graceDays: 0 }, form: formWith(DUE_DAY, { mode: 'none' }) });

    expect(result.draft.late).toEqual({ mode: 'none', graceDays: 0 });
    expect(result.rates.before).toBeCloseTo(28.59, 6);
    expect(result.rates.after).toBeNull();
  });

  it('flags a policy equal to the one in force as unchanged', () => {
    const same = preview({ late: { mode: 'usury', graceDays: 0 }, form: formWith(DUE_DAY) });
    expect(same.unchanged).toBe(true);
    expect(preview({ form: formWith(DUE_DAY) }).unchanged).toBe(false);
  });
});

describe('previewLatePolicy: issues', () => {
  it('has no draft, and no message, while a fixed rate or a multiple is still empty', () => {
    for (const patch of [{ mode: 'fixed' }, { mode: 'contract_multiple' }]) {
      const result = preview({ form: formWith(DUE_DAY, patch) });
      expect(result).toMatchObject({ draft: null, issue: null, after: null });
    }
  });

  it('explains a rate of zero, a multiple above 3 and grace days out of range', () => {
    expect(preview({ form: formWith(DUE_DAY, { mode: 'fixed', rate: { value: '0', ...FIXED_RATE } }) })).toMatchObject({ draft: null, issue: 'La tasa de la mora debe ser mayor que cero.' });
    expect(preview({ form: formWith(DUE_DAY, { mode: 'contract_multiple', multiple: '4' }) }).issue).toBe('El múltiplo debe ser mayor que 0 y de hasta 3 veces la tasa del contrato.');
    expect(preview({ form: formWith(DUE_DAY, { graceDays: '91' }) }).issue).toBe('Los días de gracia deben ser un número entero de 0 a 90.');
  });

  it('asks for a real date', () => {
    expect(preview({ form: formWith('2026-02-30') })).toMatchObject({ draft: null, issue: 'Elige una fecha válida.' });
    expect(preview({ form: formWith('') })).toMatchObject({ draft: null, issue: 'Elige una fecha válida.' });
  });
});

describe('previewLatePolicy: legal notices', () => {
  const noticeCodes = (result) => result.notices.map((notice) => notice.code);

  it('shows the stale cap when the table stops before today, even if nothing is overdue yet', () => {
    const stale = usuryLegal(['2025-01-01', '2026-01-31', 28.59]);
    const overdue = preview({ legal: stale, form: formWith(DUE_DAY) });
    const notOverdue = preview({ legal: stale, form: formWith(DAY_10), events: [MORA_DISBURSEMENT] });

    expect(overdue.notices).toContainEqual(expect.objectContaining({ code: 'late_cap_stale', lastValidTo: '2026-01-31' }));
    expect(noticeCodes(notOverdue)).toContain('late_cap_stale');
    expect(noticeCodes(notOverdue).filter((code) => code === 'late_cap_stale')).toHaveLength(1);
  });

  it('says so when no cap is known for the modality', () => {
    const result = preview({ legal: usuryLegal(['2026-01-01', '2026-12-31', 30, 'mortgage']), form: formWith(DUE_DAY) });

    expect(noticeCodes(result)).toContain('late_cap_unknown');
    expect(result.capEA).toBeNull();
  });

  it('has no legal notice with a current cap, or when mora is off', () => {
    expect(preview({ form: formWith(DUE_DAY) }).notices).toEqual([]);
    expect(preview({ legal: usuryLegal(['2025-01-01', '2026-01-31', 28.59]), form: formWith(DUE_DAY, { mode: 'none' }) }).notices).toEqual([]);
  });
});

describe('describeLate', () => {
  it('names each mode in one line, with the grace days when there are any', () => {
    expect(describeLate(undefined)).toBe('sin mora');
    expect(describeLate({ mode: 'usury', graceDays: 0 })).toBe('tasa máxima legal (usura)');
    expect(describeLate({ mode: 'usury', graceDays: 1 })).toBe('tasa máxima legal (usura) · gracia de 1 día');
    expect(describeLate({ mode: 'fixed', graceDays: 5, rate: { value: 36, ...FIXED_RATE } })).toBe('tasa fija 36 % E.A. · gracia de 5 días');
    expect(describeLate({ mode: 'contract_multiple', graceDays: 0, multiple: 1.5 })).toBe('1,5 veces la tasa del contrato');
  });
});
