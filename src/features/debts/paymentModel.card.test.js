// @vitest-environment node
import { project } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { makeCard } from './debtFixtures';
import { previewPayment } from './paymentModel';

const TODAY = '2026-04-20';
const preview = (amount) => {
  const debt = makeCard();
  return previewPayment({ debt, events: [], projection: project(debt, [], TODAY), actorId: 'u1', today: TODAY, amount, effectiveOn: TODAY, strategy: null });
};

describe('previewPayment for a credit card', () => {
  it('treats the minimum, the full statement and anything above as plain payments, with no strategy to choose', () => {
    for (const amount of ['146102', '621102', '800000']) {
      const result = preview(amount);
      expect(result.requiresStrategy).toBe(false);
      expect(result.draft).toEqual({ kind: 'payment', effectiveOn: TODAY, amountMinor: Number(amount) });
    }
    expect(preview('146102').dueMinor).toBe(146102);
  });

  it('splits a payment into fee, interest and principal, and reports what exceeds the statement', () => {
    expect(preview('621102').preview).toMatchObject({ principalMinor: 600000, interestMinor: 10392, feesMinor: 10710, costMinor: 21102, surplusMinor: 0 });
    expect(preview('800000').preview).toMatchObject({ costMinor: 21102, surplusMinor: 178898 });
  });
});
