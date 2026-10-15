// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allowedTexts, explainFacts, resolveLegal } from '../../../../packages/finance-core/index.js';
import { reviewedCopy } from '../../../../packages/finance-core/test/helpers/explainCopy.js';
import { GOLDEN_LEGAL, GOLDEN_TERMS } from '../../../../packages/finance-core/test/helpers/lateGolden.js';
import { mulberry32 } from '../../../../packages/finance-core/test/helpers/prng.js';
import { EA, debt, french, interestFree } from '../../../../packages/finance-core/test/helpers/loans.js';
import { NUMBER_WORDS, guardParaphrase, numbersIn } from '../guard.js';
import { renderExplain } from './render.js';

// Property of design G1 and spec DE2: whatever the topic, the debt, the date, the legal tables and the figures the user
// states, every number in a rendered part comes from the facts (or the reviewed copy or the debt name), no number is spelled
// out, every part fits in a message, and the hardened paraphrase guard accepts the template itself.

const copy = reviewedCopy();
const TOPICS = ['rate_conventions', 'usury_ibc', 'mora', 'payment_allocation', 'charges'];
const FEE = { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45000 };
const IVA = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 };
const GMF = { id: 'gmf', kind: 'tax', label: 'GMF', basis: 'pctOfSubtotal', value: 0.4 };
const named = (row, name) => ({ ...row, name });

const DEBTS = {
  none: null,
  loan: debt(french({ rate: EA(24) })),
  mora: named(debt(GOLDEN_TERMS), 'Libranza 2026'),
  mortgage: debt(french({ kind: 'mortgage', late: { mode: 'usury' } })),
  family: debt(interestFree()),
  charged: named(debt(french({ charges: [FEE, IVA, GMF] })), 'Crédito 2'),
  noLate: debt(french({ late: { mode: 'none' } })),
};
const DATES = ['2026-02-15', '2026-02-25', '2026-10-13', '2027-02-05'];
const LEGALS = [GOLDEN_LEGAL, resolveLegal([{ kind: 'ibc', modality: 'consumer', value: 1906, validFrom: '2026-10-01', validTo: '2026-10-31' }]), null];
const CONVENTIONS = ['EA', 'NAMV', 'MV', 'NATV', 'NAMA'];
const fold = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function options(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const opts = { copy };
  if (random() < 0.5) opts.stated = { convention: pick(CONVENTIONS), value: Math.round(random() * 5900) / 100 + 0.1 };
  if (random() < 0.5) opts.amountMinor = 50000 + Math.floor(random() * 3000000);
  return { opts, legal: pick(LEGALS), today: pick(DATES) };
}

describe('renderExplain: property over topics, debts, dates and stated figures', () => {
  it.each([1, 7, 42, 2026])('keeps every number, word and length inside the facts (seed %i)', (seed) => {
    const random = mulberry32(seed);
    const statuses = new Set();
    let rendered = 0;
    for (const topic of TOPICS) {
      for (const [label, row] of Object.entries(DEBTS)) {
        for (let round = 0; round < DATES.length; round += 1) {
          const { opts, legal, today } = options(random);
          if (label === 'none' && round === 0) delete opts.stated; // keeps the generic answer in every run
          const facts = explainFacts(topic, row, [], legal, today, opts);
          const allowed = new Set(numbersIn(allowedTexts(facts).join('\n')));
          const { parts, followUps } = renderExplain(facts);

          expect(parts.length, `${topic}/${label}`).toBeGreaterThan(0);
          expect(followUps.length).toBeLessThanOrEqual(2);
          for (const part of parts) {
            expect(part.length, `${topic}/${label}/${today}`).toBeLessThanOrEqual(1200);
            expect(numbersIn(part).filter((number) => !allowed.has(number)), `${topic}/${label}/${today}`).toEqual([]);
            expect(NUMBER_WORDS.test(fold(part)), `${topic}/${label}/${today}`).toBe(false);
            expect(guardParaphrase(part, facts, allowedTexts(facts)), `${topic}/${label}/${today}`).toBe(part.trim());
            expect(part).toContain('Información educativa con tus datos; no es asesoría financiera.');
          }
          statuses.add(`${topic}:${facts.status}`);
          rendered += parts.length;
        }
      }
    }
    expect(rendered).toBeGreaterThan(140);
    // The property is not vacuous: every topic was rendered both with figures and as a generic answer.
    for (const topic of TOPICS) {
      expect(statuses.has(`${topic}:ok`)).toBe(true);
      expect(statuses.has(`${topic}:generic`)).toBe(true);
    }
  });
});
