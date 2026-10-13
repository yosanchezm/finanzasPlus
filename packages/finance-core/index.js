// Public API of the finance core: pure, dependency-free ESM that runs in the
// browser and on Node 16 (the Appwrite Function runtime). Import from here;
// anything not re-exported below is internal.
export { ValidationError } from './src/errors.js';
export { assertMinor, roundUnit, sumMinor } from './src/money.js';
export {
  PERIODICITIES,
  addDays,
  addMonthsClamped,
  compareIso,
  daysBetween,
  isIsoDate,
  periodDates,
} from './src/calendar.js';
export {
  CONVENTIONS,
  convertRate,
  normalizeRate,
  periodicRate,
  rateLabel,
  toEffectiveAnnual,
} from './src/rates.js';
export { SMMLV_TABLE, USURY_TABLE, ley1555Notice, usuryNotice } from './src/legal.js';
