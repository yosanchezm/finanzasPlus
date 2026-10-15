import { readFileSync } from 'node:fs';
import { resolveLegal } from '../../src/legal.js';
import { debt } from './loans.js';

// The mora golden of the debt-plan-changes spec: a 10,000,000 loan at 24 % EA with a 10,000 fee, mora at the
// usury cap of 28.59 % EA, whose first installment (390,381 = 10,000 + 180,876 + 199,505) is due on 2026-02-15.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/late-28.59-golden.json', import.meta.url), 'utf8'));

export const GOLDEN_LEGAL = resolveLegal([], { usuryTable: fixture.usuryTable });
export const goldenDebt = (terms = fixture.terms) => debt(terms);
export const GOLDEN_TERMS = fixture.terms;
export const DUE_ON = fixture.installment.dueOn;
export const TEN_DAYS_LATE = '2026-02-25';
