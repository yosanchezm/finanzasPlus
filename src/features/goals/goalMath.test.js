import { describe, expect, it } from 'vitest';
import { goalProgress, suggestedMonthlyContribution } from './goalMath';

const today = new Date(2026, 9, 12);
const isoDate = (year, month, day) => new Date(year, month, day, 12).toISOString();

describe('goalProgress', () => {
  it('computes the floored percentage and the remaining amount', () => {
    expect(goalProgress({ targetMinor: 15000000, currentMinor: 8400000 })).toEqual({
      current: 8400000, target: 15000000, percent: 56, remaining: 6600000,
    });
  });

  it('caps at 100 % and never reports a negative remainder', () => {
    expect(goalProgress({ targetMinor: 100, currentMinor: 150 })).toMatchObject({ percent: 100, remaining: 0 });
  });

  it('handles a missing target', () => {
    expect(goalProgress({})).toMatchObject({ percent: 0, remaining: 0 });
  });
});

describe('suggestedMonthlyContribution', () => {
  it('splits the remainder over the months left until the target date', () => {
    const goal = { targetMinor: 15000000, currentMinor: 8400000, targetDate: isoDate(2027, 5, 15) };
    expect(suggestedMonthlyContribution(goal, today)).toBe(825000);
  });

  it('uses at least one month when the target is this month', () => {
    const goal = { targetMinor: 1000, currentMinor: 0, targetDate: isoDate(2026, 9, 30) };
    expect(suggestedMonthlyContribution(goal, today)).toBe(1000);
  });

  it('returns null without a target date, when the date has passed, or when the goal is met', () => {
    expect(suggestedMonthlyContribution({ targetMinor: 1000, currentMinor: 0 }, today)).toBeNull();
    expect(suggestedMonthlyContribution({ targetMinor: 1000, currentMinor: 0, targetDate: isoDate(2026, 8, 1) }, today)).toBeNull();
    expect(suggestedMonthlyContribution({ targetMinor: 1000, currentMinor: 1000, targetDate: isoDate(2027, 0, 1) }, today)).toBeNull();
  });
});
