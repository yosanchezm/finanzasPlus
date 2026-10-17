// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { project } from '../../src/ledger/project.js';

// Approval test (fix/card-opening-statement): a card whose opening date is NOT one of its statement dates must project
// exactly as it did before the opening statement existed. Each hash below was taken on the code BEFORE that change
// (the JSON of the whole projection); it must never change.

const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const terms = (overrides = {}, card = {}) => ({ ...fixture.terms, ...overrides, card: { ...fixture.terms.card, ...card } });
const debt = (t) => ({ $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: t });
const ev = (kind, effectiveOn, amountMinor, payload, id) => ({
  $id: id,
  debtId: 'card1',
  kind,
  effectiveOn,
  amountMinor,
  payloadJson: JSON.stringify(payload ?? {}),
  $createdAt: '2026-01-01T00:00:00.000Z',
});
const hashOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const OWNER_CARD = {
  kind: 'card',
  principalMinor: 3_268_319,
  openedOn: '2026-10-16',
  rate: EA(26.5),
  system: 'none',
  periodicity: 'monthly',
  charges: [
    { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45_000 },
    { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 },
  ],
  card: { statementDay: 15, dueDay: 3 },
};

const SCENARIOS = [
  { name: 'fixture card, untouched, five statements', terms: terms(), events: [], asOf: '2026-08-20', hash: '4e8cef82323fad60' },
  {
    name: 'fixture card with payments, a purchase, an advance and an installment purchase',
    terms: terms(),
    events: [
      ev('payment', '2026-04-30', 146_102, {}, 'p1'),
      ev('charge', '2026-05-02', 80_000, { trancheType: 'revolving', label: 'Mercado' }, 'c1'),
      ev('charge', '2026-05-20', 300_000, { trancheType: 'advance', label: 'Avance' }, 'c2'),
      ev('charge', '2026-06-01', 600_000, { trancheType: 'deferred', label: 'TV', n: 6 }, 'c3'),
      ev('payment', '2026-06-10', 50_000, {}, 'p2'),
    ],
    asOf: '2026-09-02',
    hash: '7e889b7e3e89f5fe',
  },
  { name: 'fixture card with usury mora, unpaid', terms: terms({ late: { mode: 'usury' } }), events: [], asOf: '2026-07-20', hash: '014f3e65e131584f' },
  { name: 'owner card opened the day after its statement', terms: OWNER_CARD, events: [], asOf: '2026-12-20', hash: '641d8e9b1ec8d45f' },
  {
    name: 'owner card opened the day after its statement, paid in full on the first due date',
    terms: OWNER_CARD,
    events: [ev('payment', '2026-12-03', 3_500_000, {}, 'p1')],
    asOf: '2027-01-20',
    hash: '457946e063089825',
  },
  { name: 'card opened mid-cycle with a clamped statement day', terms: { ...OWNER_CARD, openedOn: '2026-01-20', card: { statementDay: 31, dueDay: 10 } }, events: [], asOf: '2026-05-01', hash: 'fa5e52d5fbf318c2' },
];

describe('card projection parity when the opening date is not a statement date', () => {
  it.each(SCENARIOS)('$name', ({ terms: t, events, asOf, hash }) => {
    expect(hashOf(project(debt(t), events, asOf))).toBe(hash);
  });
});
