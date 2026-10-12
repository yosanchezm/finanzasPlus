// Month keys are "YYYY-MM" in local time. Every month boundary in the app (queries,
// grouping, labels) goes through these helpers so they always agree.

/** "YYYY-MM-DD" in local time, for <input type="date">. */
export const dateInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** "YYYY-MM" in local time. */
export const monthKey = (date = new Date()) => dateInputValue(date).slice(0, 7);

/** Month key of an ISO timestamp, in local time; "" when missing or invalid. */
export const monthKeyOf = (isoDate) => {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? '' : monthKey(date);
};

const parseMonthKey = (key) => {
  const [year, month] = String(key).split('-').map(Number);
  return { year, monthIndex: month - 1 };
};

/** First day of the month at local midnight. */
export const monthStartDate = (key) => {
  const { year, monthIndex } = parseMonthKey(key);
  return new Date(year, monthIndex, 1);
};

export const addMonths = (key, amount) => {
  const { year, monthIndex } = parseMonthKey(key);
  return monthKey(new Date(year, monthIndex + amount, 1));
};

/** Half-open [start, end) range of the month as ISO timestamps. */
export const monthRange = (key) => ({
  start: monthStartDate(key).toISOString(),
  end: monthStartDate(addMonths(key, 1)).toISOString(),
});

/** `count` month keys, oldest first, ending at `key`. */
export const monthsEndingAt = (key, count) => Array.from({ length: count }, (_, index) => addMonths(key, index - count + 1));

export const daysInMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
