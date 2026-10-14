// Public API of the finance core: pure, dependency-free ESM that runs in the
// browser and on Node 16 (the Appwrite Function runtime). Import from here;
// anything not re-exported below is internal.
export { CommitError, TermsTooLarge, ValidationError } from './src/errors.js';
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
export {
  DEFAULT_LEGAL,
  LEGAL_MODALITIES,
  SMMLV_TABLE,
  USURY_TABLE,
  capOn,
  legalOf,
  ley1555Notice,
  resolveLegal,
  smmlvFor,
  usuryFromIbcBp,
  usuryNotice,
} from './src/legal.js';
export { LATE_MODES, dailyRate, defaultLateFor, lateEAOn, lateRateOn, modalityOf, normalizeLate } from './src/late/policy.js';
export { TERMS_MAX_CHARS, TERMS_SCHEMA_VERSION, normalizeCharges, parseTerms, serializeTerms, validateTerms } from './src/terms.js';
export { evaluateCharges, removeCharge } from './src/charges.js';
export { buildSchedule, summarizeSchedule } from './src/schedule/index.js';
export { EVENT_KINDS, activeEvents, sortEvents, validateEvent } from './src/ledger/events.js';
export { allocate } from './src/ledger/allocate.js';
export { cycleDates, minimumPayment } from './src/card/card.js';
export { project, registerProjector } from './src/ledger/project.js';
export { buildCostRow, commitPlan, planCommit } from './src/ledger/commit.js';
export { previewChange } from './src/ledger/preview.js';
export { buildRestructureTerms, restructureCarry } from './src/ledger/restructure.js';
export { simulateExtra } from './src/prepay/simulate.js';
export { compareStrategies } from './src/prepay/compare.js';
export { ADVICE_DEFAULTS, advise } from './src/advice/advice.js';
export { buildFacts, renderSummary } from './src/advice/facts.js';
