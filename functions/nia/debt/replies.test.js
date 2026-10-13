// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TELEGRAM_LIMIT, clampTelegram, listReply } from './replies.js';

const plain = (text) => text.replace(/ /g, ' ');
const item = (name, extra = {}) => ({ name, kind: 'vehicle', lender: '', balanceMinor: 9800495, pastDueMinor: 0, nextDue: { dueOn: '2026-11-10', amountMinor: 380381 }, eaPercent: 24, ...extra });

describe('clampTelegram', () => {
  it('leaves a short message alone', () => {
    expect(clampTelegram('hola')).toBe('hola');
    expect(clampTelegram('x'.repeat(TELEGRAM_LIMIT))).toHaveLength(TELEGRAM_LIMIT);
  });

  it('cuts a long message to 4096 characters at a line break and says so', () => {
    const long = Array.from({ length: 600 }, (_, index) => `línea ${index} con algo de texto`).join('\n');
    const clamped = clampTelegram(long);

    expect(long.length).toBeGreaterThan(TELEGRAM_LIMIT);
    expect(clamped.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    expect(clamped).toMatch(/recortado\)$/);
    expect(clamped.startsWith('línea 0 con algo de texto\nlínea 1')).toBe(true);
    expect(clamped.split('\n').slice(-2)[0]).toMatch(/^línea \d+ con algo de texto$/);
  });

  it('cuts a single huge line to the limit', () => {
    expect(clampTelegram('y'.repeat(10000), 100).length).toBeLessThanOrEqual(100);
  });
});

describe('listReply', () => {
  it('lists each debt with its balance, next installment and EA, and the total balance', () => {
    const text = plain(listReply([item('Crédito Vehículo'), item('Hipoteca', { balanceMinor: 120000000, nextDue: { dueOn: '2026-11-05', amountMinor: 1500000 }, eaPercent: 12.5 })]));

    expect(text).toContain('Tus deudas (2)');
    expect(text).toContain('• Crédito Vehículo · saldo $ 9.800.495 · próxima cuota $ 380.381 el 2026-11-10 · 24% E.A.');
    expect(text).toContain('• Hipoteca · saldo $ 120.000.000 · próxima cuota $ 1.500.000 el 2026-11-05 · 12.5% E.A.');
    expect(text).toContain('Saldo total: $ 129.800.495');
  });

  it('flags overdue amounts, paid-off debts and unreadable debts, and leaves the unreadable out of the total', () => {
    const text = plain(listReply([item('Moto', { pastDueMinor: 400000 }), item('Libre', { balanceMinor: 0, nextDue: null }), { name: 'Rota', unreadable: true }]));

    expect(text).toContain('Moto · saldo $ 9.800.495 · próxima cuota $ 380.381 el 2026-11-10 · 24% E.A. · vencido $ 400.000');
    expect(text).toContain('• Libre · saldo $ 0 · sin cuotas pendientes');
    expect(text).toContain('• Rota · no pude leer sus términos');
    expect(text).toContain('Saldo total: $ 9.800.495');
  });

  it('explains how to create the first debt when there are none', () => {
    expect(listReply([])).toContain('No hay deudas registradas');
  });

  it('shows 15 debts and counts the rest', () => {
    const many = Array.from({ length: 18 }, (_, index) => item(`Deuda ${index}`));
    const text = listReply(many);

    expect(text.split('\n').filter((line) => line.startsWith('• '))).toHaveLength(15);
    expect(text).toContain('y 3 más en la web');
  });
});
