export const goalProgress = (goal = {}) => {
  const target = Number(goal.targetMinor || 0);
  const current = Number(goal.currentMinor || 0);
  const percent = target ? Math.min(Math.floor((current / target) * 100), 100) : 0;
  return { current, target, percent, remaining: Math.max(target - current, 0) };
};

/**
 * Remaining amount split over the calendar months left until targetDate (at least one).
 * Null when it cannot be computed honestly: no date, date already passed, or goal met.
 */
export const suggestedMonthlyContribution = (goal = {}, today = new Date()) => {
  if (!goal.targetDate) return null;
  const targetDate = new Date(goal.targetDate);
  if (Number.isNaN(targetDate.getTime())) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (targetDate < startOfToday) return null;
  const { remaining } = goalProgress(goal);
  if (remaining <= 0) return null;
  const months = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth());
  return Math.ceil(remaining / Math.max(months, 1));
};
