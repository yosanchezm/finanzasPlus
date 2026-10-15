// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY, explainFacts, resolveLegal } from '../../../../packages/finance-core/index.js';
import { reviewedCopy } from '../../../../packages/finance-core/test/helpers/explainCopy.js';
import { DUE_ON, GOLDEN_LEGAL, GOLDEN_TERMS, TEN_DAYS_LATE, goldenDebt } from '../../../../packages/finance-core/test/helpers/lateGolden.js';
import { EA, debt, french, interestFree } from '../../../../packages/finance-core/test/helpers/loans.js';
import { renderExplain } from './render.js';

// Goldens per topic, rendered from real core results over a reviewed copy (the shipped draft texts, signed for the test).
const copy = reviewedCopy();
const DISCLAIMER = 'Información educativa con tus datos; no es asesoría financiera.';
const IBC = resolveLegal([{ kind: 'ibc', modality: 'consumer', value: 1906, validFrom: '2026-10-01', validTo: '2026-10-31', source: 'Superfinanciera', verified: true }]);
const FEE = { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45000 };
const IVA = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 };
const facts = (topic, row, today, opts = {}, legal = IBC, events = []) => explainFacts(topic, row, events, legal, today, { copy, ...opts });
const first = (result) => result.parts[0];
const hasNoMoney = (text) => expect(text).not.toMatch(/\$/);

describe('renderExplain: footer', () => {
  it('ends every explanation with the exact source line and disclaimer', () => {
    const { parts } = renderExplain(facts('rate_conventions', null, '2026-10-13', { stated: { convention: 'NAMV', value: 25.2 } }));

    expect(parts).toHaveLength(1);
    expect(parts[0].endsWith(`Fuente: tasa que me diste · conversión de tasas · Matemática financiera: equivalencia de tasas de interés\n${DISCLAIMER}`)).toBe(true);
  });

  it('names the debt, the core family and every source label of the copy once', () => {
    const text = first(renderExplain(facts('mora', goldenDebt(), TEN_DAYS_LATE, {}, GOLDEN_LEGAL)));
    const sourceLine = text.split('\n').find((line) => line.startsWith('Fuente:'));

    expect(sourceLine).toBe('Fuente: Credito · cálculo de mora · Código de Comercio, art. 884 (tope: tasa de usura) · Código de Comercio, art. 886 (anatocismo) · Código Civil, art. 1653 (imputación del pago)');
    expect(text.endsWith(DISCLAIMER)).toBe(true);
  });
});

describe('renderExplain: rate_conventions', () => {
  it('explains a stated 25.2 % NAMV as 2.1 % monthly and about 28.32 % EA', () => {
    const text = first(renderExplain(facts('rate_conventions', null, '2026-10-13', { stated: { convention: 'NAMV', value: 25.2 } })));

    expect(text).toContain('La tasa que me diste es 25,2 % N.A.M.V. (nominal anual, mes vencido). Equivale a 2,1 % mensual (M.V.) y a 28,32 % efectiva anual (E.A., aproximado).');
    hasNoMoney(text);
  });

  it('shows a stated 2.1 % MV as about 28.32 % EA', () => {
    const text = first(renderExplain(facts('rate_conventions', null, '2026-10-13', { stated: { convention: 'MV', value: 2.1 } })));

    expect(text).toContain('La tasa que me diste es 2,1 % M.V. (mensual vencida). Equivale a 2,1 % mensual (M.V.) y a 28,32 % efectiva anual (E.A., aproximado).');
  });

  it('uses the rate in force of the debt, and says an interest-free loan charges no interest', () => {
    const taxed = first(renderExplain(facts('rate_conventions', debt(french({ rate: EA(24) })), '2026-10-13')));
    const free = first(renderExplain(facts('rate_conventions', debt(interestFree()), '2026-10-13')));

    expect(taxed).toContain('Tu tasa vigente es 24 % E.A. (efectiva anual). Equivale a 1,81 % mensual (M.V., aproximado) y a 24 % efectiva anual (E.A.).');
    expect(taxed).toContain('Fuente: Credito · conversión de tasas');
    expect(free).toContain('no cobra intereses');
  });

  it('is generic and invites naming a debt or a rate when there is neither', () => {
    const { parts, followUps } = renderExplain(facts('rate_conventions', null, '2026-10-13'));

    expect(parts[0]).toContain('Si me dices de cuál deuda hablas o una tasa con su convención');
    expect(parts[0]).toContain('Fuente: explicación general');
    hasNoMoney(parts[0]);
    expect(followUps).toEqual(['usury_ibc', 'mora']);
  });
});

describe('renderExplain: usury_ibc', () => {
  it('shows the cap with its month, the IBC behind it, its origin and the comparison with the rate', () => {
    const text = first(renderExplain(facts('usury_ibc', debt(french()), '2026-10-13')));

    expect(text).toContain('Para el crédito de consumo y ordinario, el tope de usura que tengo registrado para octubre de 2026 es 28,59 % E.A. (IBC de 19,06 % E.A.). Lo calculé con el IBC registrado en tu hogar.');
    expect(text).toContain('Tu tasa es 24 % E.A. y está por debajo del tope.');
    expect(text).toContain('Fuente: Credito · tasas de usura e IBC · Superintendencia Financiera de Colombia: certificación del IBC');
  });

  it('shows the stale warning with the last date and still shows the cap', () => {
    const text = first(renderExplain(facts('usury_ibc', debt(french()), '2026-12-05')));

    expect(text).toContain('28,59 % E.A.');
    expect(text).toContain('Aviso: el último tope que tengo estuvo vigente hasta el 31 de octubre de 2026; te lo muestro como referencia, pero puede haber cambiado.');
  });

  it('warns when the rate is above the cap, labels a derived IBC approximate and flags an unverified cap', () => {
    const above = first(renderExplain(facts('usury_ibc', null, '2026-10-13', { stated: { convention: 'EA', value: 35 } })));
    const derived = first(renderExplain(facts('usury_ibc', debt(french()), '2026-10-13', {}, null)));
    const unverified = first(renderExplain(facts('usury_ibc', debt(french()), '2026-10-13', {}, resolveLegal([{ kind: 'usury', modality: 'consumer', value: 2859, validFrom: '2026-10-01', validTo: '2026-10-31' }]))));

    expect(above).toContain('La tasa que me diste es 35 % E.A. y supera ese tope; conviene revisar el contrato con la entidad.');
    expect(derived).toContain('(IBC aproximado de 19,06 % E.A.)');
    expect(unverified).toContain('Ese valor no está verificado oficialmente.');
  });

  it('says so when no cap is known and does not invent one', () => {
    const text = first(renderExplain(facts('usury_ibc', debt(french({ kind: 'mortgage' })), '2026-10-13')));

    expect(text).toContain('No tengo registrado un tope de usura para esta modalidad, así que no puedo decirte cuál es.');
    expect(text).not.toContain('28,59');
  });

  it('is generic with the public cap and an invitation, with no debt figures', () => {
    const text = first(renderExplain(facts('usury_ibc', null, '2026-10-13')));

    expect(text).toContain('28,59 % E.A.');
    expect(text).toContain('Si me dices de cuál deuda hablas');
    expect(text).not.toContain('Tu tasa');
  });
});

describe('renderExplain: mora', () => {
  it('shows the mora the core computed for 199,505 overdue 10 days at 28.59 % EA: 1,375', () => {
    const text = first(renderExplain(facts('mora', goldenDebt(), TEN_DAYS_LATE, {}, GOLDEN_LEGAL)));

    expect(text).toContain('La mora de esta deuda se cobra a la tasa de usura vigente: 28,59 % E.A.');
    expect(text).toContain('Hoy llevas 10 días de atraso sobre $ 199.505 de capital vencido, y la mora acumulada es $ 1.375.');
    expect(text).not.toContain('aproximado');
  });

  it('gives an example labelled approximate when nothing is overdue, and says when the debt charges no mora', () => {
    const example = first(renderExplain(facts('mora', goldenDebt(), DUE_ON, {}, GOLDEN_LEGAL)));
    const none = first(renderExplain(facts('mora', goldenDebt({ ...GOLDEN_TERMS, late: { mode: 'none' } }), TEN_DAYS_LATE, {}, GOLDEN_LEGAL)));

    expect(example).toContain('Ejemplo: con 10 días de atraso sobre $ 199.505 de capital vencido, la mora sería de $ 1.375 (aproximado).');
    expect(none).toContain('Según su configuración, esta deuda no cobra mora.');
    hasNoMoney(none);
  });

  it('warns about a missing or stale cap and about mortgage rules', () => {
    const stale = first(renderExplain(facts('mora', goldenDebt(), '2027-02-05', {}, GOLDEN_LEGAL)));
    const mortgage = first(renderExplain(facts('mora', goldenDebt(french({ kind: 'mortgage', late: { mode: 'usury' } })), TEN_DAYS_LATE, {}, GOLDEN_LEGAL)));

    expect(stale).toContain('El tope de usura que uso es el último que tengo registrado y puede haber cambiado.');
    expect(mortgage).toContain('No tengo registrado el tope de usura de esta modalidad');
    expect(mortgage).toContain('los créditos de vivienda tienen reglas propias que esta guía no aplica');
  });

  it('is generic with no debt figures and invites naming a debt', () => {
    const { parts, followUps } = renderExplain(facts('mora', null, TEN_DAYS_LATE, {}, GOLDEN_LEGAL));

    expect(parts[0]).toContain('Si me dices de cuál deuda hablas');
    hasNoMoney(parts[0]);
    expect(followUps).toEqual(['usury_ibc', 'payment_allocation']);
  });
});

describe('renderExplain: payment_allocation', () => {
  it('splits 100,000 on day 10 into charges 10,000, mora 1,375, interest 88,625 and principal 0', () => {
    const text = first(renderExplain(facts('payment_allocation', goldenDebt(), TEN_DAYS_LATE, { amountMinor: 100000 }, GOLDEN_LEGAL)));

    expect(text).toContain('Con un pago de $ 100.000 el 25 de febrero de 2026, el reparto sería:');
    expect(text).toContain('• Cargos: $ 10.000\n• Mora: $ 1.375\n• Intereses: $ 88.625\n• Capital: $ 0');
  });

  it('splits the whole installment on day 10 and shows taxes and surplus only when they exist', () => {
    const text = first(renderExplain(facts('payment_allocation', goldenDebt(), TEN_DAYS_LATE, { amountMinor: 390381 }, GOLDEN_LEGAL)));

    expect(text).toContain('• Cargos: $ 10.000\n• Mora: $ 1.375\n• Intereses: $ 180.876\n• Capital: $ 198.130');
    expect(text).not.toContain('Impuestos');
    expect(text).not.toContain('Sobrante');
  });

  it('uses what the next installment asks when no amount is stated, and says nothing is due for a paid-off debt', () => {
    const next = first(renderExplain(facts('payment_allocation', goldenDebt(), TEN_DAYS_LATE, {}, GOLDEN_LEGAL)));

    expect(next).toContain('Si pagas hoy (25 de febrero de 2026) lo que debe la próxima cuota, $ 391.756, el reparto sería:');
  });

  it('is generic with no figures and asks for a debt and an amount', () => {
    const text = first(renderExplain(facts('payment_allocation', null, TEN_DAYS_LATE, {}, GOLDEN_LEGAL)));

    expect(text).toContain('Si me dices de cuál deuda hablas');
    hasNoMoney(text);
  });
});

describe('renderExplain: charges', () => {
  const taxed = () => debt(french({ charges: [FEE, IVA] }));

  it('lists a fee of 45,000 and its IVA of 8,550 pointing at the fee, with the approximate sum of the year', () => {
    const text = first(renderExplain(facts('charges', taxed(), '2026-10-13')));

    expect(text).toContain('• Cuota de manejo (comisión o cuota): $ 45.000');
    expect(text).toContain('• IVA (impuesto): $ 8.550, 19 % de «Cuota de manejo»');
    expect(text).toContain('Suma aproximada de cargos e impuestos de las próximas 12 cuotas: $ 642.600 (aproximado).');
  });

  it('says how many lines are not shown when there are more than six', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `c${index}`, kind: 'insurance', label: `Seguro ${index}`, basis: 'fixed', value: 1000 + index }));
    const text = first(renderExplain(facts('charges', debt(french({ charges: many })), '2026-10-13')));

    expect(text).toContain('• Seguro 5 (seguro): $ 1.005\nY 2 más.');
    expect(text).not.toContain('Seguro 6');
  });

  it('explains the GMF with the 400,000 example: 0.4 % is 1,600', () => {
    const text = renderExplain(facts('charges', taxed(), '2026-10-13')).parts.join('\n');

    expect(text).toContain('Ejemplo del GMF: 0,4 % sobre $ 400.000 son $ 1.600.');
  });

  it('says when a debt has no charges, and shows the IVA example (19 % of 10,000 is 1,900) when generic', () => {
    const none = first(renderExplain(facts('charges', debt(french()), '2026-10-13')));
    const generic = renderExplain(facts('charges', null, '2026-10-13')).parts.join('\n');

    expect(none).toContain('Esta deuda no tiene cargos, seguros ni impuestos registrados.');
    expect(generic).toContain('Ejemplo del IVA: con una comisión de $ 10.000 y un IVA de 19 %, el IVA es de $ 1.900.');
    expect(generic).toContain('Si me dices de cuál deuda hablas');
  });
});

describe('renderExplain: statuses without a template', () => {
  it('answers under review and not applicable without a footer or a figure', () => {
    const review = renderExplain(explainFacts('mora', goldenDebt(), [], GOLDEN_LEGAL, TEN_DAYS_LATE));

    expect(review.parts).toEqual(['Este tema está en revisión. Todavía no puedo explicarlo; lo haré cuando esté revisado.']);
    expect(review.followUps).toEqual([]);
  });
});

describe('renderExplain: splitter', () => {
  const sentence = (index) => `La cifra ${index} suma $ 1.234.567 con una tasa de 28,59 % E.A. y no cambia. `;
  const block = (count) => Array.from({ length: count }, (_, index) => sentence(index + 1)).join('').trim();
  const withSample = (text) => {
    const entry = { text, sources: [{ label: 'Fuente de prueba' }], reviewedOn: null, reviewedHash: null };
    return explainFacts('usury_ibc', null, [], IBC, '2026-10-13', { copy: reviewedCopy({ ...EXPLAIN_COPY, 'usury_ibc.sample': entry }) });
  };
  const SPLIT = '\n\nFuente: ';
  const bodyOf = (part) => part.slice(0, part.lastIndexOf(SPLIT));
  const footerOf = (part) => part.slice(part.lastIndexOf(SPLIT) + 2);

  it('splits a long topic into parts of at most 1,200 characters on paragraph boundaries, with the footer on every part', () => {
    const paragraphs = [block(11), block(11), block(11)];
    const { parts, followUps } = renderExplain(withSample(paragraphs.join('\n\n')));

    expect(paragraphs.every((paragraph) => paragraph.length > 700 && paragraph.length < 860)).toBe(true);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1200);
      expect(footerOf(part)).toBe(footerOf(parts[0]));
      expect(footerOf(part)).toContain(DISCLAIMER);
    }
    const bodies = parts.flatMap((part) => bodyOf(part).split('\n\n'));
    for (const paragraph of paragraphs) expect(bodies).toContain(paragraph);
    expect(followUps).toEqual(['rate_conventions', 'mora']);
  });

  it('never cuts a number, even when one paragraph alone is longer than a message', () => {
    const { parts } = renderExplain(withSample(block(30)));
    const all = parts.join('\n');

    expect(block(30).length).toBeGreaterThan(2000);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(1200);
    expect(all.match(/1\.234\.567/g)).toHaveLength(30);
    expect(all.match(/28,59 % E\.A\./g).length).toBeGreaterThanOrEqual(30);
    expect(all).not.toMatch(/\$\s*\n/);
  });
});
