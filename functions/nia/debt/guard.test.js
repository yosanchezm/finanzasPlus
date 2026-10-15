// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { advise, compareStrategies, serializeTerms } from '../../../packages/finance-core/index.js';
import { MAX_REPLY, guardParaphrase, numbersIn } from './guard.js';

const loanTerms = { kind: 'mortgage', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const debt = { $id: 'd1', name: 'Hipoteca', kind: 'mortgage', ownerScope: 'shared', status: 'active', termsJson: serializeTerms(loanTerms) };
const events = [{ $id: 'e1', debtId: 'd1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', $createdAt: '2026-09-10T12:00:00.000Z' }];
const facts = () => advise(compareStrategies(debt, events, { amountMinor: 2000000, on: '2026-10-13' }), { avgIncomeMinor: 5000000, avgExpenseMinor: 3500000, otherDebts: [] }).facts;

describe('numbersIn', () => {
  it('normalises thousands separators written with dots or commas', () => {
    expect(numbersIn('Abono de $ 1.234.567')).toEqual(['1234567']);
    expect(numbersIn('Abono de 1,234,567 pesos')).toEqual(['1234567']);
    expect(numbersIn('380.381 y 10.000')).toEqual(['380381', '10000']);
  });

  it('reads decimals with either separator and drops the percent sign and trailing zeros', () => {
    expect(numbersIn('28.32%')).toEqual(['28.32']);
    expect(numbersIn('28,32 %')).toEqual(['28.32']);
    expect(numbersIn('0.10 y 7,50')).toEqual(['0.1', '7.5']);
    expect(numbersIn('1.234,50 y 1,234.50')).toEqual(['1234.5', '1234.5']);
    expect(numbersIn('0.100')).toEqual(['0.1']);
  });

  it('splits ISO dates into their parts and keeps law numbers', () => {
    expect(numbersIn('hasta el 2026-10-13')).toEqual(['2026', '10', '13']);
    expect(numbersIn('Ley 1555 de 2012')).toEqual(['1555', '2012']);
  });

  it('ignores a sentence period after a number and text with no digits', () => {
    expect(numbersIn('Quedan 35 cuotas.')).toEqual(['35']);
    expect(numbersIn('sin números')).toEqual([]);
  });
});

describe('guardParaphrase', () => {
  it('returns a faithful paraphrase untouched (trimmed)', () => {
    const f = facts();
    const reply = `  Con un abono de $ ${f.text.amount} el ${f.asOf}, tu tasa es ${f.text.ea} y te quedarían ${f.text['reduceTerm.periods']} cuotas.  `;

    expect(guardParaphrase(reply, f)).toBe(reply.trim());
  });

  it('accepts the same figures written with other separators', () => {
    const f = facts();
    const reply = `Abonas ${f.text.amount.replace(/\./g, ',')} y la tasa es ${f.text.ea.replace('.', ',')}.`;

    expect(guardParaphrase(reply, f)).toBe(reply);
  });

  it('rejects a number that is not in the facts (the invented 42%)', () => {
    expect(guardParaphrase('Ahorrarías un 42% de intereses.', facts())).toBeNull();
    expect(guardParaphrase(`Ahorrarías ${Number(facts().numbers['reduceTerm.interestSaved']) + 1} pesos.`, facts())).toBeNull();
  });

  it('accepts the law number and the dates that appear in the notices', () => {
    const f = facts();
    expect(f.notices.map((notice) => notice.code)).toContain('ley1555_scope_unverified');
    expect(guardParaphrase(`Recuerda la Ley 1555 vigente al ${f.notices[0].asOf}.`, f)).not.toBeNull();
  });

  it('allows numbers from the extra texts the caller vouches for (a debt name) and nothing else', () => {
    expect(guardParaphrase('Tu crédito Libre 77 es el más caro.', facts())).toBeNull();
    expect(guardParaphrase('Tu crédito Libre 77 es el más caro.', facts(), ['Libre 77'])).not.toBeNull();
    expect(guardParaphrase('Tu crédito Libre 78 es el más caro.', facts(), ['Libre 77'])).toBeNull();
  });

  it('rejects empty and non-text replies and anything over 1200 characters', () => {
    expect(guardParaphrase('', facts())).toBeNull();
    expect(guardParaphrase('   ', facts())).toBeNull();
    expect(guardParaphrase(undefined, facts())).toBeNull();
    expect(guardParaphrase({ reply: 'x' }, facts())).toBeNull();
    expect(MAX_REPLY).toBe(1200);
    expect(guardParaphrase('a'.repeat(1200), facts())).not.toBeNull();
    expect(guardParaphrase('a'.repeat(1201), facts())).toBeNull();
  });

  it('measures the cap on the trimmed text, so surrounding blanks do not count', () => {
    expect(guardParaphrase(` ${'a'.repeat(1200)} `, facts())).toBe('a'.repeat(1200));
  });

  it('takes a different cap from the caller', () => {
    expect(guardParaphrase('a'.repeat(100), facts(), [], { maxChars: 100 })).not.toBeNull();
    expect(guardParaphrase('a'.repeat(101), facts(), [], { maxChars: 100 })).toBeNull();
    expect(guardParaphrase('a'.repeat(1201), facts(), [], { maxChars: 2000 })).not.toBeNull();
  });

  it('rejects a changed digit (28.32 to 28.23) and an invented percentage', () => {
    const f = { asOf: '2026-10-13', numbers: { ea: 28.32 }, text: { ea: '28,32 %' }, notices: [] };
    expect(guardParaphrase('Tu tasa es 28,32 % efectiva anual.', f)).not.toBeNull();
    expect(guardParaphrase('Tu tasa es 28,23 % efectiva anual.', f)).toBeNull();
    expect(guardParaphrase('Tu tasa es 42 % efectiva anual.', f)).toBeNull();
  });

  it.each([
    'Pagas cuatro por mil de GMF.',
    'Tu tasa es veintiocho por ciento.',
    'Te quedan un millón de pesos.',
    'Pagarías el doble de intereses.',
    'Es la mitad de la cuota.',
    'Te cobran cien pesos.',
    'Son dos mil pesos.',
    'Quedan tres cuotas.',
    'Debes quinientos mil pesos.',
    'Tu tasa es veinticinco por ciento.',
    'Son treinta días.',
    'Pagas el triple.',
    'Sumas doscientos pesos.',
    'CUATRO por MIL',
    'Cuántos millones son',
  ])('rejects a spelled-out number: %s', (reply) => {
    expect(guardParaphrase(reply, { asOf: '2026-10-13', numbers: {}, text: {}, notices: [] })).toBeNull();
  });

  it.each([
    'Tienes un crédito y una tarjeta.',
    'Uno de los créditos tiene mora.',
    'Sin números escritos en palabras, solo la tasa efectiva anual.',
    'Las dosis y los sentimientos no son números.',
    'Camila revisa la mora de la tarjeta.',
  ])('keeps accepting words that are not numbers, including the articles un, una and uno: %s', (reply) => {
    expect(guardParaphrase(reply, { asOf: '2026-10-13', numbers: {}, text: {}, notices: [] })).toBe(reply);
  });

  it('rejects a spelled-out number even when its digits would be allowed', () => {
    const f = { asOf: '2026-10-13', numbers: { n: 28 }, text: {}, notices: [] };
    expect(guardParaphrase('Son 28 días.', f)).not.toBeNull();
    expect(guardParaphrase('Son veintiocho días.', f)).toBeNull();
  });

  it('rejects everything with digits when the facts are unusable', () => {
    expect(guardParaphrase('Son 35 cuotas.', null)).toBeNull();
    expect(guardParaphrase('Sin números.', null)).toBe('Sin números.');
  });
});
