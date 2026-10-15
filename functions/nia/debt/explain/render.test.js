// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY, explainFacts, resolveLegal } from '../../../../packages/finance-core/index.js';
import { reviewedCopy } from '../../../../packages/finance-core/test/helpers/explainCopy.js';
import { DUE_ON, GOLDEN_LEGAL, GOLDEN_TERMS, TEN_DAYS_LATE, goldenDebt } from '../../../../packages/finance-core/test/helpers/lateGolden.js';
import { EA, debt, french, interestFree, onTime } from '../../../../packages/finance-core/test/helpers/loans.js';
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
const onTime12 = (terms = french(), count = 12) => onTime(terms, count);

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

  it('explains Ley 546 for a mortgage and states that nothing is computed with it', () => {
    const text = renderExplain(facts('usury_ibc', debt(french({ kind: 'mortgage' })), '2026-10-13')).parts.join('\n');
    const consumer = renderExplain(facts('usury_ibc', debt(french()), '2026-10-13')).parts.join('\n');

    expect(text).toContain(EXPLAIN_COPY['legal.ley546'].text);
    expect(text).toContain('Para este crédito de vivienda no calculo nada con las reglas de esa ley.');
    expect(text).toContain('Ley 546 de 1999 (normas en materia de vivienda y su financiación)');
    expect(consumer).not.toContain('Ley 546');
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

// -- card topics (S2) ------------------------------------------------------------------------------------------------
// Goldens come from the independent card fixture: statement 1 of 121,102, minimum 146,102 (21,102 of interest, fees and
// taxes plus 125,000 of capital); with mora at 28.59 % EA the 10 days to the next close give 861, and the second statement's
// interest drops from 10,392 to 9,526.
const cardFixture = JSON.parse(readFileSync(new URL('../../../../packages/finance-core/test/fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
const visa = (terms = cardFixture.terms) => ({ $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms });
const moraCard = (late = { mode: 'usury', graceDays: 0 }) => visa({ ...cardFixture.terms, late, card: { ...cardFixture.terms.card, statementDay: 20, dueDay: 10 } });
const plainCard = (principalMinor) => visa({ ...cardFixture.terms, principalMinor, charges: [], card: { ...cardFixture.terms.card, deferred: [] } });
const cardPay = (effectiveOn, amountMinor, $id) => ({ $id, debtId: 'c1', kind: 'payment', effectiveOn, amountMinor, payloadJson: '{}', $createdAt: '2026-01-01T00:00:00.000Z' });
const onCard = (topic, row, today, events = [], opts = {}) => explainFacts(topic, row, events, GOLDEN_LEGAL, today, { copy, ...opts });
const textOf = (topic, row, today, events, opts) => first(renderExplain(onCard(topic, row, today, events, opts)));

describe('renderExplain: card_statement', () => {
  it('shows the last statement, its minimum payment and the minimum rule with the footer of the card', () => {
    const text = textOf('card_statement', visa(), '2026-04-20');

    expect(text).toContain('Tu último extracto cortó el 15 de abril de 2026 y su fecha límite de pago es el 30 de abril de 2026. Lo cobrado en el periodo es $ 121.102:');
    expect(text).toContain('• Intereses: $ 10.392\n• Cuotas de compras diferidas: $ 100.000\n• Cuota de manejo e impuestos: $ 10.710');
    expect(text).toContain('Pago mínimo: $ 146.102. Para pagar todo el extracto: $ 621.102.');
    expect(text).toContain('Según la regla de tu tarjeta, el pago mínimo suma los intereses, los cargos, los impuestos y las cuotas del periodo, más el 5 % del saldo de compras corrientes y avances; nunca es menos de $ 20.000. Nunca supera el total del extracto.');
    expect(text).toContain('El próximo corte es el 15 de mayo de 2026 y la fecha límite de pago, el 30 de mayo de 2026.');
    expect(text).toContain('Fuente: Visa · extractos de tarjeta · Contrato y extracto de tu tarjeta de crédito');
    expect(text).not.toContain('aproximado');
  });

  it('says what a payment already covered, and that an unpaid minimum is past its date', () => {
    const partial = textOf('card_statement', visa(), '2026-04-26', [cardPay('2026-04-25', 100_000, 'p1')]);
    const late = textOf('card_statement', visa(), '2026-05-10');
    const covered = textOf('card_statement', visa(), '2026-04-26', [cardPay('2026-04-25', 146_102, 'p2')]);

    expect(partial).toContain('Ya abonaste $ 100.000 al mínimo y faltan $ 46.102.');
    expect(late).toContain('La fecha límite ya pasó y el mínimo sigue sin pagarse: faltan $ 146.102.');
    expect(covered).toContain('El pago mínimo de este extracto ya está cubierto.');
  });

  it('describes the other minimum rules with the figures of the card', () => {
    const rule = (name, pct) => visa({ ...cardFixture.terms, card: { ...cardFixture.terms.card, minPayment: { rule: name, pct, floorMinor: 0 } } });

    expect(textOf('card_statement', rule('installments_due', 0), '2026-04-20')).toContain('el pago mínimo suma solo los intereses, los cargos, los impuestos y las cuotas del periodo.');
    expect(textOf('card_statement', rule('pct_balance', 10), '2026-04-20')).toContain('el pago mínimo es el 10 % del valor total del extracto.');
  });

  it('says there is no statement yet, and is generic with an invitation and no figures without a card', () => {
    const early = textOf('card_statement', visa(), '2026-04-10');
    const { parts, followUps } = renderExplain(onCard('card_statement', null, '2026-04-20'));

    expect(early).toContain('Esta tarjeta todavía no tiene un extracto registrado. El próximo corte es el 15 de abril de 2026, con fecha límite de pago el 30 de abril de 2026.');
    expect(parts[0]).toContain('Si me dices de cuál tarjeta hablas, te muestro tu último extracto con tus números.');
    expect(parts[0]).toContain('Fuente: explicación general · extractos de tarjeta');
    hasNoMoney(parts[0]);
    expect(followUps).toEqual(['card_interest_drop', 'mora']);
  });
});

describe('renderExplain: card_interest_drop', () => {
  it('shows the revolving base, the first-cycle approximation and the minimum-only what-if, labelled approximate', () => {
    const text = renderExplain(onCard('card_interest_drop', visa(), '2026-04-20')).parts.join('\n');

    expect(text).toContain('En tu extracto del 15 de abril de 2026, los intereses fueron $ 10.392 (aproximado).');
    expect(text).toContain('Los intereses de compras corrientes se calcularon sobre una base de $ 500.000 (aproximado), a 2,08 % mensual (28 % efectiva anual).');
    expect(text).toContain('Es tu primer extracto: la app cuenta el saldo inicial como ya facturado, por eso estas cifras son aproximadas.');
    expect(text).toContain('¿Y si pagas solo el mínimo?');
    expect(text).toContain('Si el 30 de abril de 2026 pagas solo el mínimo ($ 146.102), en el corte del 15 de mayo de 2026 los intereses serían de $ 9.873 (aproximado), sobre una base de $ 475.000 (aproximado).');
    expect(text).toContain('Si pagas todo el extracto ($ 621.102), serían de $ 0 (aproximado).');
    expect(text).toContain('Pagar solo el mínimo costaría $ 9.873 (aproximado) más en intereses. Es una estimación: no incluye compras ni pagos nuevos.');
    expect(text).toContain('Fuente: Visa · intereses de tarjeta · Contrato y extracto de tu tarjeta de crédito · Método de cálculo de la app para tarjetas (aproximado)');
  });

  it('explains a statement paid in full by its due date as a zero revolving base, with the drop against the last statement', () => {
    const first1 = onCard('card_interest_drop', plainCard(800_000), '2026-04-20');
    const paid = onCard('card_interest_drop', plainCard(800_000), '2026-05-20', [cardPay('2026-04-30', 800_000 + first1.numbers.interest, 'full')]);
    const text = renderExplain(paid).parts.join('\n');

    expect(text).toContain('La parte del extracto anterior que pagaste a tiempo ($ 800.000) no generó intereses.');
    expect(text).toContain('Como pagaste el extracto completo hasta la fecha límite de pago, la base de intereses de compras corrientes es cero.');
    expect(text).toContain(`Frente al extracto anterior (${paid.text.previousInterest}), los intereses bajaron ${paid.text.drop}.`);
    expect(text).not.toContain('Es tu primer extracto');
  });

  it('explains the part still unpaid after the due date as the revolving base', () => {
    const text = renderExplain(onCard('card_interest_drop', visa(), '2026-05-20', [cardPay('2026-04-28', 321_102, 'part')])).parts.join('\n');

    expect(text).toContain('La parte del extracto anterior que pagaste a tiempo ($ 200.000) no generó intereses.');
    expect(text).toContain('sobre una base de $ 300.000');
    expect(text).not.toContain('es cero');
  });

  it('explains why the second statement interest dropped from 10,392 to 9,526 when the mora applies', () => {
    const text = renderExplain(onCard('card_interest_drop', moraCard(), '2026-05-20')).parts.join('\n');

    expect(text).toContain('En tu extracto del 20 de mayo de 2026, los intereses fueron $ 9.526.');
    expect(text).toContain('En parte del periodo, $ 41.667 (aproximado) del capital del pago mínimo sin pagar estuvo en mora; por esos días se cobra mora en lugar de interés corriente.');
    expect(text).toContain('Sin eso, los intereses habrían sido de $ 10.392 (aproximado), así que la diferencia es de $ 866 (aproximado).');
    expect(text).toContain('Frente al extracto anterior ($ 10.392), los intereses bajaron $ 866.');
  });

  it('has no statement to explain before the first cut-off date, and invites naming a card without one', () => {
    const early = textOf('card_interest_drop', visa(), '2026-04-10');
    const generic = textOf('card_interest_drop', null, '2026-04-20');

    expect(early).toContain('Esta tarjeta todavía no tiene un extracto, así que aún no hay intereses por explicar. Tu tasa es 2,08 % mensual (28 % efectiva anual).');
    expect(generic).toContain('Si me dices de cuál tarjeta hablas, te muestro de dónde salen sus intereses con tus números.');
    hasNoMoney(generic);
  });
});

describe('renderExplain: card mora, allocation and charges', () => {
  it('explains the mora of a card on the unmet capital of the minimum as approximate: 125,000 for 10 days gives 861', () => {
    const text = textOf('mora', moraCard(), '2026-05-20');

    expect(text).toContain('La mora de esta deuda se cobra a la tasa de usura vigente: 28,59 % E.A.');
    expect(text).toContain('Tu pago mínimo es de $ 146.102: $ 21.102 son intereses, cargos e impuestos, que los pagos cubren primero, y $ 125.000 son capital. La mora corre sobre el capital del mínimo que sigue sin pagar: hoy $ 125.000.');
    expect(text).toContain('Llevas 10 días de atraso y la mora acumulada es $ 861 (aproximado). Se cobra como una línea del extracto del siguiente corte; mientras corre, ese capital no paga interés corriente.');
    expect(text).not.toContain('de capital vencido');
  });

  it('gives an approximate example for a card whose minimum is not due yet', () => {
    const text = textOf('mora', moraCard(), '2026-04-22');

    expect(text).toContain('Ejemplo: si el mínimo de $ 146.102 no se paga, su capital sin pagar de $ 125.000 correría mora 10 días y la mora sería de $ 861 (aproximado).');
  });

  it('splits a payment on a card into charges, taxes, mora, interest and capital, and says where the capital goes', () => {
    const stated = textOf('payment_allocation', visa(), '2026-04-20', [], { amountMinor: 200_000 });
    const minimum = textOf('payment_allocation', visa(), '2026-04-20');
    const early = textOf('payment_allocation', visa(), '2026-04-10');

    expect(stated).toContain('Con un pago de $ 200.000 el 20 de abril de 2026, el reparto sería:\n• Cargos: $ 9.000\n• Impuestos: $ 1.710\n• Mora: $ 0\n• Intereses: $ 10.392\n• Capital: $ 178.898');
    expect(stated).toContain('En una tarjeta, el capital se aplica primero a las cuotas de compras diferidas ya facturadas, luego a los avances y al final al saldo de compras corrientes.');
    expect(minimum).toContain('Si pagas hoy (20 de abril de 2026) el pago mínimo pendiente, $ 146.102, el reparto sería:');
    expect(minimum).toContain('• Capital: $ 125.000');
    expect(early).toContain('Esta tarjeta no tiene un pago mínimo pendiente, así que no hay un pago para repartir.');
  });

  it('lists the fee and the IVA of the last statement with the approximate year, and says when there is no statement', () => {
    const text = textOf('charges', visa(), '2026-04-20');
    const early = textOf('charges', visa(), '2026-04-10');

    expect(text).toContain('Cargos de tu último extracto:\n• Cuota de manejo (comisión o cuota): $ 9.000\n• IVA (impuesto): $ 1.710, 19 % de «Cuota de manejo»');
    expect(text).toContain('Suma aproximada de cargos e impuestos de 12 extractos como el último: $ 128.520 (aproximado).');
    expect(early).toContain('Esta tarjeta todavía no tiene un extracto, así que aún no hay cargos que mostrar.');
    expect(early).toContain('Ejemplo del GMF: 0,4 % sobre $ 400.000 son $ 1.600.');
  });
});

describe('renderExplain: restructure_whatif', () => {
  const text = (row, today, events = [], legal = GOLDEN_LEGAL) => renderExplain(facts('restructure_whatif', row, today, {}, legal, events)).parts.join('\n');

  it('golden: shows 391,756 refinanced, or 390,381 waiving the mora, and the new balance', () => {
    const result = text(goldenDebt(), TEN_DAYS_LATE);

    expect(result).toContain('Si reestructuras hoy (25 de febrero de 2026), lo que se refinancia de lo vencido es $ 391.756: el capital de las cuotas vencidas más $ 180.876 de intereses, $ 10.000 de cargos y $ 1.375 de mora.');
    expect(result).toContain('La deuda nueva arrancaría con un saldo de $ 10.192.251: el saldo actual de $ 10.000.000 más los intereses, cargos, impuestos y mora vencidos.');
    expect(result).toContain('Si la entidad perdona la mora ($ 1.375), lo que se refinancia es $ 390.381 y la deuda nueva arrancaría con $ 10.190.876.');
    expect(result).toContain('Fuente: Credito · cálculo de reestructuración · Acuerdo de reestructuración con tu entidad financiera · Método de cálculo de la app para saldos vencidos');
    expect(result.endsWith(DISCLAIMER)).toBe(true);
  });

  it('adds the taxes to the breakdown when there are any', () => {
    const taxed = debt({ ...GOLDEN_TERMS, charges: [...GOLDEN_TERMS.charges, { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 }] });
    const result = text(taxed, TEN_DAYS_LATE);

    expect(result).toMatch(/de intereses, \$ 10\.000 de cargos, \$ 1\.900 de impuestos y \$ 1\.375 de mora\./);
  });

  it('says there is no mora to forgive when the debt has none', () => {
    const result = text(debt({ ...GOLDEN_TERMS, late: { mode: 'none' } }), TEN_DAYS_LATE);

    expect(result).toContain('Esta deuda no tiene mora acumulada, así que no hay mora que perdonar.');
    expect(result).not.toContain('Si la entidad perdona la mora (');
  });

  it('says nothing is overdue and keeps the current balance as the new principal', () => {
    const result = text(goldenDebt(), '2026-02-10');

    expect(result).toContain('Hoy (10 de febrero de 2026) esta deuda no tiene cuotas vencidas, así que no hay nada vencido que sumar: la deuda nueva arrancaría con el saldo actual de $ 10.000.000.');
    expect(result).not.toContain('Si la entidad perdona la mora (');
  });

  it('warns that housing credit has its own mora rules', () => {
    const result = text(debt({ ...GOLDEN_TERMS, kind: 'mortgage' }), TEN_DAYS_LATE);

    expect(result).toContain('Además, los créditos de vivienda tienen reglas propias que esta guía no aplica; confirma la mora con tu banco.');
  });

  it('is generic with an invitation and no figure, and does not apply to a card', () => {
    const generic = renderExplain(facts('restructure_whatif', null, TEN_DAYS_LATE, {}, GOLDEN_LEGAL));
    const cardRow = { $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: { ...GOLDEN_TERMS, kind: 'card', card: { statementDay: 20, dueDay: 10, minPayment: { rule: 'installments_due', pct: 0, floorMinor: 0 } } } };
    const card = renderExplain(facts('restructure_whatif', cardRow, TEN_DAYS_LATE, {}, GOLDEN_LEGAL));

    expect(generic.parts[0]).toContain('Si me dices de cuál deuda hablas, te muestro con tus números cuánto se refinancia y con qué saldo arrancaría la deuda nueva.');
    hasNoMoney(generic.parts[0]);
    expect(generic.parts[0]).toContain('Fuente: explicación general · cálculo de reestructuración');
    expect(generic.followUps).toEqual(['prepayment', 'mora']);
    expect(card.parts).toEqual(['Ese tema aplica solo a préstamos, y esa deuda es una tarjeta de crédito.']);
  });
});

describe('renderExplain: prepayment', () => {
  const family = () => debt(interestFree());
  const paidOne = [{ $id: 'p1', debtId: 'd1', kind: 'payment', effectiveOn: '2026-02-15', amountMinor: 100_000, payloadJson: '{}', $createdAt: '2026-01-01T00:00:00.000Z' }];
  const text = (row, today, opts = {}, events = [], legal = IBC) => renderExplain(facts('prepayment', row, today, opts, legal, events)).parts.join('\n');

  it('golden: 1,200,000 at 0 %, 1 paid, extra 300,000 leaves 8 installments reducing the term and 11 reducing the installment', () => {
    const result = text(family(), '2026-03-01', { amountMinor: 300_000 }, paidOne);

    expect(result).toContain('Con un abono extra de $ 300.000 el 1 de marzo de 2026, hoy te quedan 11 cuotas de $ 100.000.');
    expect(result).toContain('• Reduciendo el plazo: la cuota sigue en $ 100.000 y te quedarían 8 cuotas. Intereses que te ahorras: $ 0.');
    expect(result).toContain('• Reduciendo la cuota: el plazo sigue en 11 cuotas y la cuota bajaría a $ 72.727 (aproximado). Intereses que te ahorras: $ 0.');
    expect(result).toContain('Fuente: Credito · simulación de abonos extra · ');
    expect(result).toContain('Ley 1555 de 2012 (prepago de créditos sin penalidad)');
    expect(result.endsWith(DISCLAIMER)).toBe(true);
  });

  it('shows the Ley 1555 notice with the 880 minimum wages threshold and the unverified-scope caveat', () => {
    const result = text(family(), '2026-03-01', { amountMinor: 300_000 }, paidOne);

    expect(result).toContain(EXPLAIN_COPY['legal.ley1555'].text);
    expect(result).toContain('Como referencia, 880 salarios mínimos equivalen a $ 1.540.796.400 (salario mínimo de $ 1.750.905), y el valor inicial de esta deuda está por debajo de ese tope. El alcance de la ley para tu crédito no está verificado: confírmalo con tu entidad.');
  });

  it('says the law may not apply above the threshold, and when no minimum wage is known or it may be stale', () => {
    const above = text(debt(french({ principalMinor: 2_000_000_000 })), '2026-10-13', { amountMinor: 1_000_000 });
    const unknown = text(debt(french()), '2024-10-13', { amountMinor: 1_000_000 }, [], resolveLegal([], { smmlvTable: [] }));
    const stale = text(debt(french()), '2027-02-01', { amountMinor: 1_000_000 }, onTime12());

    expect(above).toContain('y el valor inicial de esta deuda supera ese tope, así que la ley podría no aplicarte.');
    expect(unknown).toContain('No tengo registrado el salario mínimo de este año, así que no puedo compararlo con el tope de referencia.');
    expect(unknown).not.toContain('880 salarios mínimos equivalen');
    expect(stale).toContain('El salario mínimo que uso es el último que tengo registrado y puede haber cambiado.');
  });

  it('labels the interest saved approximate', () => {
    const result = text(debt(french()), '2027-01-20', { amountMinor: 2_000_000 }, onTime12());

    expect(result).toMatch(/• Reduciendo el plazo: la cuota sigue en \$ 380\.381 y te quedarían \d+ cuotas\. Intereses que te ahorras: \$ [\d.]+ \(aproximado\)\./);
    expect(result).toMatch(/• Reduciendo la cuota: el plazo sigue en \d+ cuotas y la cuota bajaría a \$ [\d.]+ \(aproximado\)\. Intereses que te ahorras: \$ [\d.]+ \(aproximado\)\./);
  });

  it('shows one option when the amortization system gives the same result for both', () => {
    const german = french({ system: 'german', n: 24 });
    const result = text(debt(german), '2026-08-01', { amountMinor: 1_000_000 }, onTime12(german, 6));

    expect(result).toContain('En este sistema de amortización, reducir el plazo y reducir la cuota dan el mismo resultado.');
    expect(result).not.toContain('• Reduciendo el plazo');
  });

  it('says the debt would be paid off, and that a registered penalty is not in the figures', () => {
    const paid = text(family(), '2026-03-01', { amountMinor: 5_000_000 }, paidOne);
    const penalized = text(debt(french({ prepaymentPenaltyPct: 2 })), '2027-01-20', { amountMinor: 2_000_000 }, onTime12());

    expect(paid).toContain('Con ese abono la deuda quedaría totalmente pagada, así que no hay plazo ni cuota que elegir.');
    expect(penalized).toContain('Tu deuda tiene registrada una penalización por prepago de 2 %; esa penalización no está incluida en estas cifras.');
  });

  it('asks for the amount, says a paid-off debt has nothing to prepay and warns about a mortgage', () => {
    const noAmount = text(debt(french()), '2026-10-13');
    const twoPaid = [...paidOne, { ...paidOne[0], $id: 'p2', effectiveOn: '2026-03-15' }];
    const owed = text(debt(interestFree({ n: 2, principalMinor: 200_000 })), '2026-04-01', { amountMinor: 50_000 }, twoPaid);
    const mortgage = text(debt(french({ kind: 'mortgage', principalMinor: 300_000_000 })), '2026-10-13', { amountMinor: 5_000_000 });

    expect(noAmount).toContain('Dime de cuánto sería el abono y te muestro cómo cambian el plazo y la cuota con tus números.');
    expect(noAmount).not.toContain('Reduciendo');
    expect(owed).toContain('Esta deuda ya no tiene saldo por pagar, así que no hay nada que abonar.');
    expect(mortgage).toContain('Este es un crédito de vivienda: sus reglas de prepago pueden ser distintas y esta guía no las calcula.');
  });

  it('is generic with an invitation and no figure', () => {
    const { parts, followUps } = renderExplain(facts('prepayment', null, '2026-10-13', { amountMinor: 300_000 }));

    expect(parts[0]).toContain('Si me dices de cuál deuda hablas y de cuánto sería el abono, te muestro con tus números cómo cambian el plazo y la cuota.');
    expect(parts[0]).toContain('Fuente: explicación general · simulación de abonos extra');
    hasNoMoney(parts[0]);
    expect(followUps).toEqual(['restructure_whatif', 'payment_allocation']);
  });
});
