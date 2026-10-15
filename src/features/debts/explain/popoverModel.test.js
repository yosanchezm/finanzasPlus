import { EXPLAIN_COPY, allowedTexts, explainFacts, releasedTopics } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER as NIA_DISCLAIMER } from '../../../../functions/nia/debt/explain/render.js';
import { DAY_10, MORA_DISBURSEMENT, makeBigLoan, makeCard, makeDebt, makeMoraCard, makeMoraLoan } from '../debtFixtures';
import { DISCLAIMER, FIGURES, popoverOf, popoversOf } from './popoverModel';

const MORA_EVENTS = [MORA_DISBURSEMENT];
const copyWithout = (...keys) => Object.fromEntries(Object.entries(EXPLAIN_COPY).filter(([key]) => !keys.includes(key)));

describe('FIGURES', () => {
  it('maps the five figures of the debt views to a released topic of the catalogue', () => {
    expect(Object.fromEntries(Object.entries(FIGURES).map(([figure, spec]) => [figure, spec.topic]))).toEqual({
      rate: 'rate_conventions',
      mora: 'mora',
      charges: 'charges',
      minimum: 'card_statement',
      statement: 'card_statement',
    });
    expect(Object.values(FIGURES).every((spec) => releasedTopics().includes(spec.topic))).toBe(true);
  });
});

describe('DISCLAIMER', () => {
  it('is the exact sentence of the spec and the one Nia prints', () => {
    expect(DISCLAIMER).toBe('Información educativa con tus datos; no es asesoría financiera.');
    expect(DISCLAIMER).toBe(NIA_DISCLAIMER);
  });
});

describe('popoverOf', () => {
  it('explains the mora of a loan with its figures, the reviewed copy, the source line and the exact disclaimer', () => {
    const debt = makeMoraLoan();
    const popover = popoverOf('mora', { debt, events: MORA_EVENTS, today: DAY_10 });

    expect(popover.figure).toBe('mora');
    expect(popover.topic).toBe('mora');
    expect(popover.title).toBe('Intereses de mora');
    expect(popover.lines).toEqual([
      'Tasa de mora vigente: 28,59 % E.A.',
      'Mora acumulada: $ 1.375 por 10 días de atraso sobre $ 199.505 de capital vencido.',
    ]);
    expect(popover.paragraphs).toEqual([EXPLAIN_COPY['legal.mora'].text, EXPLAIN_COPY['mora.sample'].text]);
    expect(popover.source).toBe(
      'Fuente: Crédito de consumo · cálculo de mora · Código de Comercio, art. 884 (tope: tasa de usura) · Código de Comercio, art. 886 (anatocismo) · Código Civil, art. 1653 (imputación del pago)',
    );
    expect(popover.disclaimer).toBe('Información educativa con tus datos; no es asesoría financiera.');
  });

  it('says so when the debt has no mora policy', () => {
    const popover = popoverOf('mora', { debt: makeMoraLoan({ late: null }), events: MORA_EVENTS, today: DAY_10 });

    expect(popover.lines).toEqual(['Esta deuda no tiene mora configurada.']);
  });

  it('shows an approximate example of a loan that is not overdue', () => {
    const popover = popoverOf('mora', { debt: makeMoraLoan(), events: MORA_EVENTS, today: '2026-01-20' });

    expect(popover.lines[0]).toBe('Tasa de mora vigente: 28,59 % E.A.');
    expect(popover.lines[1]).toMatch(/^Ejemplo: 10 días de atraso sobre \$ [\d.]+ serían \$ [\d.]+ de mora \(aproximado\)\.$/);
  });

  it('marks the mora figure of a card as approximate', () => {
    const debt = makeMoraCard();
    const popover = popoverOf('mora', { debt, events: [], today: '2026-05-10' });

    expect(popover.lines.some((line) => line.startsWith('Mora acumulada:') && line.endsWith('(aproximado).'))).toBe(true);
  });

  it('explains the rate with the stated convention and the equivalent rates, the approximate ones marked', () => {
    const popover = popoverOf('rate', { debt: makeDebt(), events: [], today: '2026-02-01' });

    expect(popover.topic).toBe('rate_conventions');
    expect(popover.title).toBe('Tu tasa');
    expect(popover.lines).toEqual(['Tasa registrada: 24 % (E.A., efectiva anual)', 'En E.A.: 24 %', 'Mensual (M.V.): 1,81 % (aproximado)']);
    expect(popover.paragraphs).toEqual([EXPLAIN_COPY['rate_conventions.sample'].text]);
    expect(popover.source).toBe('Fuente: Crédito de consumo · conversión de tasas · Matemática financiera: equivalencia de tasas de interés');
  });

  it('lists the charges of the next installment and the approximate year total', () => {
    const popover = popoverOf('charges', { debt: makeBigLoan(), events: [], today: '2026-02-01' });

    expect(popover.topic).toBe('charges');
    expect(popover.lines).toEqual(['Comisión: $ 10.000', 'En las próximas 12 cuotas: $ 120.000 (aproximado)']);
  });

  it('says so when the debt has no charges', () => {
    const popover = popoverOf('charges', { debt: makeDebt(), events: [], today: '2026-02-01' });

    expect(popover.lines).toEqual(['Esta deuda no tiene cargos ni seguros registrados.']);
  });

  it('explains the minimum payment and the statement of a card with the last statement figures', () => {
    const options = { debt: makeCard(), events: [], today: '2026-04-20' };
    const minimum = popoverOf('minimum', options);
    const statement = popoverOf('statement', options);

    expect(minimum.topic).toBe('card_statement');
    expect(minimum.title).toBe('Pago mínimo');
    expect(statement.title).toBe('Extracto de la tarjeta');
    expect(minimum.lines).toEqual(statement.lines);
    expect(minimum.lines).toContain('Pago mínimo: $ 146.102');
    expect(minimum.lines).toContain('Pago total del extracto: $ 621.102');
    expect(minimum.lines[0]).toMatch(/^Último extracto \(corte del 15 de abril de 2026\): \$ /);
    expect(minimum.paragraphs).toEqual([EXPLAIN_COPY['card_statement.sample'].text]);
    expect(minimum.source).toBe('Fuente: Visa Gold · extractos de tarjeta · Contrato y extracto de tu tarjeta de crédito');
  });

  it('yields no popover for a topic that does not fit the debt kind', () => {
    expect(popoverOf('minimum', { debt: makeDebt(), events: [], today: '2026-02-01' })).toBeNull();
    expect(popoverOf('statement', { debt: makeDebt(), events: [], today: '2026-02-01' })).toBeNull();
  });

  it('yields no popover for a topic whose copy is not released', () => {
    const copy = copyWithout('mora.sample');
    const options = { debt: makeMoraLoan(), events: MORA_EVENTS, today: DAY_10, copy };

    expect(popoverOf('mora', options)).toBeNull();
    expect(popoverOf('rate', options)).not.toBeNull();
  });

  it('yields no popover for an unknown figure', () => {
    expect(popoverOf('balance', { debt: makeDebt(), events: [], today: '2026-02-01' })).toBeNull();
  });

  it('never throws on a debt that cannot be explained', () => {
    expect(popoverOf('rate', { debt: makeDebt({ termsJson: '{bad' }), events: [], today: '2026-02-01' })).toBeNull();
  });

  it('prints only figures that come from the facts', () => {
    const cases = [
      ['mora', makeMoraLoan(), MORA_EVENTS, DAY_10],
      ['rate', makeDebt(), [], '2026-02-01'],
      ['charges', makeBigLoan(), [], '2026-02-01'],
      ['minimum', makeCard(), [], '2026-04-20'],
      ['mora', makeMoraCard(), [], '2026-05-10'],
    ];
    for (const [figure, debt, events, today] of cases) {
      const popover = popoverOf(figure, { debt, events, today });
      const allowed = allowedTexts(explainFacts(FIGURES[figure].topic, debt, events, debt.legal, today)).join('\n');
      const printed = popover.lines.join(' ').match(/\d[\d.,]*\d|\d/g) ?? [];
      expect(printed.filter((token) => !allowed.includes(token))).toEqual([]);
    }
  });

  it('does not write: the debt and the events are untouched', () => {
    const debt = makeMoraLoan();
    const events = [...MORA_EVENTS];
    const before = JSON.stringify({ debt, events });

    popoverOf('mora', { debt, events, today: DAY_10 });

    expect(JSON.stringify({ debt, events })).toBe(before);
  });
});

describe('popoversOf', () => {
  it('gives the applicable figures of a loan and leaves the card figures out', () => {
    const popovers = popoversOf({ debt: makeBigLoan(), events: [], today: '2026-02-01' });

    expect(Object.keys(popovers).sort()).toEqual(['charges', 'mora', 'rate']);
  });

  it('gives the card figures of a card', () => {
    const popovers = popoversOf({ debt: makeCard(), events: [], today: '2026-04-20' });

    expect(Object.keys(popovers).sort()).toEqual(['charges', 'minimum', 'mora', 'rate', 'statement']);
  });

  it('leaves out the figures of an unreleased topic', () => {
    const popovers = popoversOf({ debt: makeBigLoan(), events: [], today: '2026-02-01', copy: copyWithout('charges.sample') });

    expect(Object.keys(popovers).sort()).toEqual(['mora', 'rate']);
  });
});
