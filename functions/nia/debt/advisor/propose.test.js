// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LEGAL, normalizeRate, serializeTerms } from '../../../../packages/finance-core/index.js';
import { MENTIONS } from '../extract.js';
import { proposeSetup } from './propose.js';

const TODAY = '2026-10-13';
const plain = (text) => String(text).replace(/ /g, ' ');
const MV = normalizeRate({ convention: 'MV', value: 2.1 });
const EA_ZERO = normalizeRate({ convention: 'EA', value: 0 });

const card = (patch = {}, cardPatch = {}) => ({
  kind: 'card',
  name: 'Tarjeta Bancolombia',
  lender: 'Bancolombia',
  principalMinor: 0,
  openedOn: TODAY,
  rate: MV,
  rateValue: 2.1,
  n: null,
  periodicity: null,
  system: 'none',
  firstDueOn: null,
  card: { statementDay: null, dueDay: null, minRule: null, minPct: null, minFloorMinor: null, ...cardPatch },
  presets: { fee: 45000, iva: 19 },
  charges: [],
  lateStated: null,
  mentions: [],
  ...patch,
});
const complete = (patch = {}, cardPatch = {}) => card(patch, { statementDay: 15, dueDay: 30, minRule: 'interest_fees_plus_pct', ...cardPatch });
const loan = (patch = {}) => card({ kind: 'consumer', name: 'Libre inversión', principalMinor: 1200000, rate: EA_ZERO, rateValue: 0, n: 3, system: null, periodicity: null, presets: {}, ...patch });
const propose = (setupCase, debts = []) => proposeSetup(setupCase, debts, DEFAULT_LEGAL, TODAY);
const fields = (proposal) => proposal.questions.map((question) => question.field);
const codes = (items) => items.map((item) => item.code);
const lineOf = (proposal, label) => proposal.preview.chargeLines.find((line) => line.label === label);

describe('the Bancolombia card (2.1 % MV, fee 45,000 plus IVA 19 %)', () => {
  const proposal = propose(card());

  it('echoes about 28.32 % EA with the convention the user gave', () => {
    expect(proposal.mode).toBe('create');
    expect(plain(proposal.preview.rateLabel)).toBe('2.1% MV ≈ 28.32% EA');
    expect(plain(proposal.preview.eaText)).toContain('28.32');
  });

  it('links the IVA to the fee: the preview shows 8,550 over the 45,000 fee', () => {
    expect(proposal.preview.chargeLines.map((line) => [line.label, plain(line.amountText)])).toEqual([['Cuota de manejo', '$ 45.000'], ['IVA', '$ 8.550']]);
  });

  it('sets the mora to usury and lists the IVA 19 and the mora default in the assumptions', () => {
    expect(codes(proposal.assumptions)).toEqual(expect.arrayContaining(['iva_19', 'mora_default_usury']));
    expect(proposal.assumptions.find((item) => item.code === 'mora_default_usury').text).toMatch(/usura/);
    expect(proposal.assumptions.find((item) => item.code === 'iva_19').text).toContain('19');
  });

  it('asks the statement day, the due day and the minimum rule, all blocking, and offers no draft', () => {
    expect(fields(proposal)).toEqual(['statementDay', 'dueDay', 'minRule']);
    expect(proposal.questions.every((question) => question.blocking === true)).toBe(true);
    expect(proposal.questions[2].options).toEqual(['interest_fees_plus_pct', 'installments_due', 'pct_balance', 'unknown']);
    expect(proposal.draft).toBeNull();
    expect(proposal.steps).toEqual([]);
    expect(proposal.unsupported).toEqual([]);
    expect(proposal.invalid).toEqual([]);
  });

  it('is pure: frozen inputs, the same answer twice, no I/O', () => {
    const deep = (value) => {
      for (const child of Object.values(value)) if (child && typeof child === 'object') deep(child);
      return Object.freeze(value);
    };
    const input = deep(card());
    expect(() => proposeSetup(input, deep([]), DEFAULT_LEGAL, TODAY)).not.toThrow();
    expect(proposeSetup(input, [], DEFAULT_LEGAL, TODAY)).toEqual(proposeSetup(input, [], DEFAULT_LEGAL, TODAY));
  });
});

describe('a complete card', () => {
  const proposal = propose(complete());

  it('is confirmable: the draft carries the case and no question is open', () => {
    expect(proposal.questions).toEqual([]);
    expect(proposal.draft).toEqual({ setup: complete() });
  });

  it('previews the minimum payment and the next statement', () => {
    expect(plain(proposal.preview.minimumText)).toMatch(/intereses.*5 %/);
    expect(proposal.preview.nextStatementOn).toBe('2026-10-15');
    expect(codes(proposal.assumptions)).toContain('min_pct_5');
  });

  it('moves the next statement to the next month once the day has passed', () => {
    expect(propose(complete({}, { statementDay: 10, dueDay: 25 })).preview.nextStatementOn).toBe('2026-11-10');
    expect(propose(complete({}, { statementDay: 31, dueDay: 15 })).preview.nextStatementOn).toBe('2026-10-31');
  });

  it('words each minimum rule and uses the stated percentage', () => {
    expect(plain(propose(complete({}, { minRule: 'pct_balance', minPct: 3 })).preview.minimumText)).toMatch(/3 %.*extracto/);
    expect(plain(propose(complete({}, { minRule: 'installments_due' })).preview.minimumText)).toMatch(/cuotas del mes/);
    expect(codes(propose(complete({}, { minRule: 'pct_balance', minPct: 3 })).assumptions)).not.toContain('min_pct_5');
  });
});

describe('the rate and its convention', () => {
  it('asks for the convention before any preview when the user said «2% mensual»', () => {
    const proposal = propose(card({ rate: null, rateValue: 2 }));
    expect(fields(proposal)[0]).toBe('convention');
    expect(proposal.questions[0]).toMatchObject({ blocking: true, options: ['EA', 'NAMV', 'MV', 'NATV', 'NATA'] });
    expect(proposal.preview).toBeNull();
    expect(proposal.draft).toBeNull();
  });

  it('asks for the rate when there is none at all', () => {
    const proposal = propose(card({ rate: null, rateValue: null }));
    expect(fields(proposal)[0]).toBe('rate');
    expect(proposal.preview).toBeNull();
  });

  it('shows the usury notice and never blocks because of it', () => {
    const proposal = propose(complete({ rate: normalizeRate({ convention: 'MV', value: 3 }), rateValue: 3 }));
    expect(proposal.preview.usuryLines).toHaveLength(1);
    expect(proposal.preview.usuryLines[0]).toContain('tope de usura');
    expect(proposal.draft).not.toBeNull();
    expect(propose(complete()).preview.usuryLines).toEqual([]);
  });
});

describe('charges and presets', () => {
  it('asks for the amount of a preset the user mentioned without one, and offers no draft', () => {
    const proposal = propose(complete({ presets: { life: null } }));
    expect(fields(proposal)).toEqual(['amount:life']);
    expect(proposal.questions[0].blocking).toBe(true);
    expect(proposal.draft).toBeNull();
    expect(fields(propose(complete({ presets: { fee: null, insurance: null } })))).toEqual(['amount:fee', 'amount:insurance']);
  });

  it('computes a fee that includes the IVA as round(stated / 1.19) and labels it «aproximado»', () => {
    const proposal = propose(complete({ presets: { fee: 53550, iva: 19, ivaIncluded: true } }));
    expect(plain(lineOf(proposal, 'Cuota de manejo').amountText)).toBe('$ 45.000 (aproximado)');
    expect(plain(lineOf(proposal, 'IVA').amountText)).toBe('$ 8.550');
    const assumption = proposal.assumptions.find((item) => item.code === 'iva_included');
    expect(assumption.text).toContain('aproximado');
  });

  it('charges GMF 0.4 % on a 400,000 installment: 1,600', () => {
    const proposal = propose(loan({ presets: { gmf: true } }));
    expect(plain(lineOf(proposal, 'GMF (4 x 1000)').amountText)).toBe('$ 1.600');
    expect(proposal.draft).not.toBeNull();
    expect(proposal.questions).toEqual([]);
  });

  it('rejects a dangling refLabel with a typed issue and no draft', () => {
    const charges = [{ kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, cadence: 'per_installment', refLabel: 'cuota de manejo' }];
    const proposal = propose(complete({ presets: {}, charges }));
    expect(codes(proposal.invalid)).toEqual(['charge_ref_unknown']);
    expect(proposal.invalid[0].text.length).toBeGreaterThan(10);
    expect(proposal.draft).toBeNull();
  });

  it('rejects an IVA stated without any fee', () => {
    const proposal = propose(complete({ presets: { iva: 19 } }));
    expect(codes(proposal.invalid)).toEqual(['preset_requires_fee']);
    expect(proposal.draft).toBeNull();
  });
});

describe('what Nia will not guess', () => {
  it('blocks creation when the statement day or the due day stays unknown after one ask, and names the missing data', () => {
    const proposal = propose({ ...card({}, { minRule: 'installments_due' }), unknown: ['statementDay', 'dueDay'] });
    expect(proposal.draft).toBeNull();
    const stuck = proposal.questions.filter((question) => question.stuck);
    expect(stuck.map((question) => question.field)).toEqual(['statementDay', 'dueDay']);
    expect(stuck[0].text).toContain('día de corte');
    expect(stuck[1].text).toContain('día límite de pago');
    expect(stuck.every((question) => question.blocking === true)).toBe(true);
  });

  it('blocks on an unknown minimum rule with no default, and says where to find it', () => {
    const proposal = propose(complete({}, { minRule: 'unknown' }));
    expect(proposal.draft).toBeNull();
    const question = proposal.questions.find((item) => item.field === 'minRule');
    expect(question).toMatchObject({ blocking: true, stuck: true });
    expect(question.text).toMatch(/extracto|contrato/);
    expect(proposal.questions.filter((item) => item.field !== 'minRule')).toEqual([]);
  });

  it('does not fix a rule by itself when it is missing: it asks with options', () => {
    const question = propose(complete({}, { minRule: null })).questions[0];
    expect(question).toMatchObject({ field: 'minRule', blocking: true });
    expect(question.stuck).toBeUndefined();
  });

  it('answers the card limit with «no soportado aún» and still offers a card without limit', () => {
    const proposal = propose(complete({ mentions: ['card_limit'] }));
    expect(codes(proposal.unsupported)).toEqual(['card_limit']);
    expect(proposal.unsupported[0].text).toContain('no soportado aún');
    expect(proposal.draft).not.toBeNull();
  });

  it('explains every unsupported field with the same answer and does not pretend it was saved', () => {
    const proposal = propose(complete({ mentions: ['advance_rate', 'prepayment_penalty', 'allocation_order', 'mora_base', 'card_limit', 'card_limit'] }));
    expect(codes(proposal.unsupported)).toEqual(['card_limit', 'advance_rate', 'prepayment_penalty', 'allocation_order', 'mora_base']);
    for (const item of proposal.unsupported) expect(item.text).toContain('no soportado aún');
  });

  it('puts a mora on the whole installment or at a own rate in unsupported and keeps the usury default', () => {
    const whole = propose(complete({ lateStated: 'whole_installment' }));
    expect(codes(whole.unsupported)).toEqual(['mora_base']);
    expect(whole.unsupported[0].text).toContain('no soportado aún');
    const fixed = propose(complete({ lateStated: 'fixed' }));
    expect(codes(fixed.unsupported)).toEqual(['mora_fixed']);
    expect(codes(whole.assumptions)).toContain('mora_default_usury');
  });
});

describe('the mora default by kind', () => {
  it('is none for a family loan and is listed in the assumptions', () => {
    const proposal = propose(loan({ kind: 'family' }));
    expect(codes(proposal.assumptions)).toContain('mora_default_none');
    expect(codes(proposal.assumptions)).not.toContain('mora_default_usury');
  });

  it('is not an assumption when the user stated it', () => {
    expect(codes(propose(complete({ lateStated: 'usury' })).assumptions)).not.toContain('mora_default_usury');
    expect(codes(propose(complete({ lateStated: 'none' })).assumptions)).not.toContain('mora_default_usury');
  });
});

describe('a loan', () => {
  it('previews the plan and is confirmable when it is complete', () => {
    const proposal = propose(loan());
    expect(proposal.draft).toEqual({ setup: loan() });
    expect(proposal.preview.planText).toMatch(/3 cuotas mensuales/);
  });

  it('asks for what is missing, in order, without inventing it', () => {
    expect(fields(propose(loan({ name: '', principalMinor: null, n: null, rate: null, rateValue: null })))).toEqual(['name', 'rate', 'principal', 'term']);
    expect(propose(loan({ principalMinor: null })).draft).toBeNull();
  });
});

describe('the questions of a card, in order', () => {
  it('asks the name first, then the rate, then the cycle days and the rule, then the preset amounts', () => {
    const proposal = propose(card({ name: '', rate: null, rateValue: 2, presets: { fee: null, life: null } }));
    expect(fields(proposal)).toEqual(['name', 'convention', 'statementDay', 'dueDay', 'minRule', 'amount:fee', 'amount:life']);
  });
});

// ---- adjust an existing debt (S6b, ADV6, ADV8) ----

describe('proposeSetup: adjust an existing debt', () => {
  const fixtureCard = JSON.parse(readFileSync(new URL('../../../../packages/finance-core/test/fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
  // Visa: statement day 15, due day 30, 28 % EA, a 9,000 fee with its IVA, mora at the usury cap.
  const visa = (extra = {}) => ({ $id: 'c1', name: 'Visa', kind: 'card', status: 'active', lender: 'Bancolombia', ownerScope: 'shared', termsJson: serializeTerms({ ...fixtureCard.terms, late: { mode: 'usury', graceDays: 0 } }), events: [], ...extra });
  const vehicleTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
  const vehicle = () => ({ $id: 'l1', name: 'Crédito Vehículo', kind: 'vehicle', status: 'active', lender: '', ownerScope: 'shared', termsJson: serializeTerms(vehicleTerms), events: [{ $id: 'e0', debtId: 'l1', householdId: 'h1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', actorId: 'telegram:1', source: 'telegram', dedupeKey: 'seed:e0', $createdAt: '2026-09-10T12:00:00.000Z' }] });
  const adjust = (patch = {}, cardPatch = {}) => card({ adjust: true, adjustKind: null, debtRef: 'visa', changeOn: null, rate: null, rateValue: null, presets: {}, ...patch }, cardPatch);
  const EA = (value) => normalizeRate({ convention: 'EA', value });
  const steps = (proposal) => proposal.steps.map((step) => step.action);

  it('lists the stored statement day 15 against «siempre fue el 20» as a terms_correction, and offers no draft of a new debt', () => {
    const proposal = propose(adjust({ adjustKind: 'fix' }, { statementDay: 20 }), [visa()]);

    expect(proposal).toMatchObject({ mode: 'adjust', draft: null, questions: [], invalid: [], unsupported: [] });
    expect(proposal.steps).toEqual([{ action: 'terms_correction', draft: { card: { statementDay: 20 } }, label: 'Corregir el día de corte a 20' }]);
  });

  it('corrects only what differs: a statement day equal to the stored one is not a step, and says so', () => {
    const same = propose(adjust({ adjustKind: 'fix' }, { statementDay: 15 }), [visa()]);
    const partly = propose(adjust({ adjustKind: 'fix' }, { statementDay: 15, dueDay: 25 }), [visa()]);

    expect(same.steps).toEqual([]);
    expect(codes(same.assumptions)).toContain('same_as_stored');
    expect(partly.steps[0].draft).toEqual({ card: { dueDay: 25 } });
  });

  it('never asks fix or change for card days and minimum payment: a correction is the only way to record them', () => {
    const proposal = propose(adjust({}, { statementDay: 20, minRule: 'pct_balance', minPct: 10 }), [visa()]);

    expect(proposal.questions).toEqual([]);
    expect(proposal.steps[0]).toMatchObject({ action: 'terms_correction', draft: { card: { statementDay: 20, minPayment: { rule: 'pct_balance', pct: 10 } } } });
    expect(codes(proposal.assumptions)).not.toContain('card_days_as_correction');
    expect(codes(propose(adjust({ adjustKind: 'change' }, { statementDay: 20 }), [visa()]).assumptions)).toContain('card_days_as_correction');
  });

  it('turns «bajó la tasa el mes pasado» into a rate_change dated by the user, and the same rate as a correction when it was wrong from the start', () => {
    const change = propose(adjust({ adjustKind: 'change', rate: EA(22), rateValue: 22, changeOn: '2026-09-13' }), [vehicle()]);
    const fix = propose(adjust({ adjustKind: 'fix', rate: EA(22), rateValue: 22, debtRef: 'vehiculo' }), [vehicle()]);

    expect(change.steps).toEqual([{ action: 'rate_change', draft: { effectiveOn: '2026-09-13', rate: EA(22) }, label: expect.stringContaining('Cambiar la tasa') }]);
    expect(fix.steps).toEqual([{ action: 'terms_correction', draft: { rate: EA(22) }, label: expect.stringContaining('Corregir la tasa') }]);
  });

  it('asks fix_or_change with the two buttons when the rate differs and it cannot tell, and does not ask when the rate is the stored one', () => {
    const ambiguous = propose(adjust({ rate: EA(22), rateValue: 22, debtRef: 'vehiculo' }), [vehicle()]);
    const same = propose(adjust({ rate: EA(24), rateValue: 24, debtRef: 'vehiculo' }), [vehicle()]);

    expect(ambiguous.questions).toEqual([{ field: 'fix_or_change', text: expect.stringContaining('Crédito Vehículo'), options: ['fix', 'change'], blocking: true }]);
    expect(ambiguous.steps).toEqual([]);
    expect(same.questions).toEqual([]);
    expect(codes(same.assumptions)).toContain('same_as_stored');
  });

  it('asks the convention of a stated rate before anything else', () => {
    const proposal = propose(adjust({ adjustKind: 'change', rate: null, rateValue: 22, debtRef: 'vehiculo' }), [vehicle()]);

    expect(fields(proposal)).toEqual(['convention']);
    expect(proposal.questions[0].options).toEqual(['EA', 'NAMV', 'MV', 'NATV', 'NATA']);
  });

  it('puts the corrections first and then the rest in the order of the description: rate, charges, mora', () => {
    const proposal = propose(adjust({ adjustKind: 'change', rate: EA(22), rateValue: 22, presets: { gmf: true }, lateStated: 'none' }, { dueDay: 25 }), [visa()]);

    expect(steps(proposal)).toEqual(['terms_correction', 'rate_change', 'charge_change', 'late_policy']);
    expect(proposal.steps[2].draft).toEqual({ effectiveOn: TODAY, op: 'add', add: { presets: { gmf: true }, charge: null } });
    expect(proposal.steps[3].draft).toEqual({ effectiveOn: TODAY, late: { mode: 'none', graceDays: 0 } });
  });

  it('skips a charge the debt already has, and a mora policy that is already in force, saying why', () => {
    const proposal = propose(adjust({ presets: { fee: 45000, iva: 19 }, lateStated: 'usury' }), [visa()]);

    expect(proposal.steps).toEqual([]);
    expect(codes(proposal.assumptions)).toEqual(expect.arrayContaining(['charge_exists', 'late_same']));
  });

  it('asks the amount of a preset that came without one, and reports a charge it cannot build', () => {
    const missing = propose(adjust({ presets: { life: null } }), [visa()]);
    const dangling = propose(adjust({ charges: [{ kind: 'tax', label: 'Extra', basis: 'pctOfCharge', value: 10, cadence: 'per_installment', refLabel: 'no existe' }] }), [visa()]);

    expect(fields(missing)).toEqual(['amount:life']);
    expect(dangling.steps).toEqual([]);
    expect(codes(dangling.invalid)).toEqual(['charge_ref_unknown']);
  });

  it('answers «no soportado aún» for the card limit and the other fields it cannot save, with no step and no pretence of saving', () => {
    const limit = propose(adjust({ mentions: ['card_limit'] }), [visa()]);

    expect(limit.mode).toBe('adjust');
    expect(limit.steps).toEqual([]);
    expect(limit.unsupported).toEqual([{ code: 'card_limit', text: expect.stringContaining('no soportado aún') }]);
    for (const code of MENTIONS) {
      const proposal = propose(adjust({ mentions: [code] }), [visa()]);
      expect(codes(proposal.unsupported)).toEqual([code]);
      expect(proposal.unsupported[0].text).toContain('no soportado aún');
      expect(proposal.steps).toEqual([]);
    }
    expect(codes(propose(adjust({ lateStated: 'whole_installment' }), [visa()]).unsupported)).toEqual(['mora_base']);
  });

  it('keeps the supported steps next to the unsupported ones', () => {
    const proposal = propose(adjust({ adjustKind: 'fix', mentions: ['card_limit'] }, { statementDay: 20 }), [visa()]);

    expect(steps(proposal)).toEqual(['terms_correction']);
    expect(codes(proposal.unsupported)).toEqual(['card_limit']);
  });

  it('says which debt when it cannot find or choose one', () => {
    const two = [visa(), visa({ $id: 'c2', name: 'Mastercard' })];

    expect(codes(propose(adjust({ debtRef: 'hipoteca' }, { statementDay: 20 }), two).invalid)).toEqual(['debt_not_found']);
    expect(codes(propose(adjust({ debtRef: 'tarjeta' }, { statementDay: 20 }), two).invalid)).toEqual(['debt_ambiguous']);
    expect(propose(adjust({ debtRef: 'tarjeta' }, { statementDay: 20 }), two).invalid[0].text).toContain('Mastercard');
  });
});
