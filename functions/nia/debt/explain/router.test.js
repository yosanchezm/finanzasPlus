// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_TOPICS } from '../../../../packages/finance-core/index.js';
import { glossaryTopic } from './router.js';

describe('glossaryTopic: glossary questions that name a debt concept', () => {
  it.each([
    ['¿qué es NAMV?', 'rate_conventions'],
    ['¿cómo funciona la mora?', 'mora'],
    ['explícame la usura', 'usury_ibc'],
    ['¿qué es el 4x1000?', 'charges'],
  ])('routes %s to %s', (text, topic) => {
    expect(glossaryTopic(text)).toEqual({ topic });
  });

  it.each([
    ['¿Qué es el IBC?', 'usury_ibc'],
    ['que significa tasa nominal', 'rate_conventions'],
    ['¿Cuál es la diferencia entre efectiva y nominal?', 'rate_conventions'],
    ['para qué sirve el GMF', 'charges'],
    ['¿Qué es la cuota de manejo?', 'charges'],
    ['¿qué es el IVA de la cuota de manejo?', 'charges'],
    ['¿Qué es la fecha de corte?', 'card_statement'],
    ['como funciona el pago mínimo', 'card_statement'],
    ['¿por qué bajaron los intereses de mi tarjeta?', 'card_interest_drop'],
    ['¿Qué es reestructurar una deuda?', 'restructure_whatif'],
    ['¿qué es un abono a capital?', 'prepayment'],
    ['¿Qué dice la Ley 1555?', 'prepayment'],
    ['¿qué son los intereses?', 'rate_conventions'],
    ['EXPLÍCAME LA MORA', 'mora'],
    ['como se aplica un pago?', 'payment_allocation'],
  ])('also routes %s to %s (case and accents folded)', (text, topic) => {
    expect(glossaryTopic(text)).toEqual({ topic });
  });

  it('routes every topic of the catalogue from some question, so none is unreachable', () => {
    const reached = [
      '¿qué es NAMV?',
      '¿qué es la usura?',
      '¿qué es la mora?',
      '¿cómo se aplica un pago?',
      '¿qué es el GMF?',
      '¿qué es el extracto?',
      '¿por qué bajaron los intereses?',
      '¿qué es reestructurar?',
      '¿qué es el abono a capital?',
    ].map((text) => glossaryTopic(text).topic);
    expect(reached).toEqual(EXPLAIN_TOPICS);
  });

  it('prefers the most specific concept when a question names several', () => {
    expect(glossaryTopic('¿cómo cobra la mora el seguro de la tarjeta?')).toEqual({ topic: 'mora' });
    expect(glossaryTopic('¿por qué bajaron los intereses de mi extracto?')).toEqual({ topic: 'card_interest_drop' });
  });
});

describe('glossaryTopic: messages that keep their original action', () => {
  it.each([
    'pagué la mora',
    'pagué 200.000 de mora',
    'abona 500.000 a capital',
    'registra la cuota de manejo',
    'qué es una acción en bolsa',
    'hola',
    '',
    '¿qué es una acción en bolsa?',
    '¿cuánto debo?',
    'agrega un seguro de vida',
    'cambia la tasa a 22% EA',
    'quita el seguro de vida del crédito',
    'crea una tarjeta con cuota de manejo',
    'configura la mora a la usura',
    'activa la mora',
    'anota que pagué la mora',
  ])('does not route %j', (text) => {
    expect(glossaryTopic(text)).toBeNull();
  });

  it('vetoes a write verb even when the message is a question about a concept', () => {
    expect(glossaryTopic('¿puedes registrar la mora que pagué?')).toBeNull();
    expect(glossaryTopic('¿me abonas 100.000 a la mora?')).toBeNull();
  });

  it('needs a question cue: a bare statement that names a concept is not a glossary question', () => {
    expect(glossaryTopic('la mora de mi crédito')).toBeNull();
    expect(glossaryTopic('mi seguro')).toBeNull();
  });

  it('gives null when the message carries an attachment', () => {
    expect(glossaryTopic('¿qué es la mora?', { hasAttachment: true })).toBeNull();
    expect(glossaryTopic('¿qué es la mora?', { hasAttachment: false })).toEqual({ topic: 'mora' });
  });
});

describe('glossaryTopic: unreleased topics', () => {
  it('still routes them, so the reply can say the topic is under review', () => {
    expect(glossaryTopic('¿qué es la mora?', { released: [] })).toEqual({ topic: 'mora' });
    expect(glossaryTopic('¿qué es la mora?', { released: ['usury_ibc'] })).toEqual({ topic: 'mora' });
  });
});

describe('glossaryTopic: follow-up with the marker of the last explanation', () => {
  const marker = { topic: 'mora', debtId: 'd1' };

  it('gives the marker topic to a short question with no concept keyword', () => {
    expect(glossaryTopic('¿y con ejemplo?', { marker })).toEqual({ topic: 'mora', fromMarker: true });
    expect(glossaryTopic('¿por qué?', { marker: { topic: 'charges', debtId: null } })).toEqual({ topic: 'charges', fromMarker: true });
    expect(glossaryTopic('y como funciona?', { marker })).toEqual({ topic: 'mora', fromMarker: true });
  });

  it('gives null without a marker', () => {
    expect(glossaryTopic('¿y con ejemplo?')).toBeNull();
    expect(glossaryTopic('¿y con ejemplo?', { marker: null })).toBeNull();
  });

  it('lets a new concept keyword win over the marker', () => {
    expect(glossaryTopic('¿y la usura?', { marker })).toEqual({ topic: 'usury_ibc' });
  });

  it('ignores the marker for a long message, for a message with no question cue and for a write', () => {
    const long = `¿y podrías darme un ejemplo con números más detallado${' por favor'.repeat(5)}?`;
    expect(long.length).toBeGreaterThan(60);
    expect(glossaryTopic(long, { marker })).toBeNull();
    expect(glossaryTopic('gracias', { marker })).toBeNull();
    expect(glossaryTopic('registra un pago?', { marker })).toBeNull();
  });

  it('ignores a marker whose topic is not in the catalogue', () => {
    expect(glossaryTopic('¿y con ejemplo?', { marker: { topic: 'tax_returns', debtId: 'd1' } })).toBeNull();
  });

  it('gives null with an attachment even when the marker is present', () => {
    expect(glossaryTopic('¿y con ejemplo?', { marker, hasAttachment: true })).toBeNull();
  });
});
