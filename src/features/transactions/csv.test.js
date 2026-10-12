import { describe, expect, it } from 'vitest';
import { buildTransactionsCsv, escapeCsvValue } from './csv';

const BOM = String.fromCharCode(0xfeff);

describe('escapeCsvValue', () => {
  it('quotes values with separators, quotes or line breaks and doubles inner quotes', () => {
    expect(escapeCsvValue('simple')).toBe('simple');
    expect(escapeCsvValue('uno; dos')).toBe('"uno; dos"');
    expect(escapeCsvValue('uno, dos')).toBe('"uno, dos"');
    expect(escapeCsvValue('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(escapeCsvValue('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
    expect(escapeCsvValue('a\r\nb')).toBe('"a\r\nb"');
  });

  it('renders empty values for null and undefined', () => {
    expect(escapeCsvValue(undefined)).toBe('');
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(0)).toBe('0');
  });
});

describe('buildTransactionsCsv', () => {
  const rows = [
    { merchant: 'Mercado, semanal', categoryName: 'Alimentación', type: 'expense', amountMinor: 286400, ownerScope: 'shared', occurredAt: new Date(2026, 9, 27, 12).toISOString(), note: 'Con "descuento"' },
    { merchant: 'Nómina', categoryName: 'Ingresos', type: 'income', amountMinor: 5200000, ownerScope: 'you', occurredAt: new Date(2026, 9, 25, 12).toISOString() },
    { merchant: 'Taxi', categoryName: 'Transporte', type: 'expense', amountMinor: 48900, ownerScope: 'partner', occurredAt: new Date(2026, 9, 3, 12).toISOString(), note: 'ida\nvuelta' },
  ];

  it('starts with a UTF-8 BOM and a semicolon-separated Spanish header (es-CO Excel list separator)', () => {
    const csv = buildTransactionsCsv(rows, 'you');

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1).split('\r\n')[0]).toBe('Fecha;Concepto;Categoría;Tipo;Quién;Monto;Nota');
  });

  it('writes one escaped line per row with signed plain amounts', () => {
    const lines = buildTransactionsCsv(rows, 'you').slice(1).split('\r\n');

    expect(lines[1]).toBe('2026-10-27;"Mercado, semanal";Alimentación;Gasto;Compartido;-286400;"Con ""descuento"""');
    expect(lines[2]).toBe('2026-10-25;Nómina;Ingresos;Ingreso;Tú;5200000;');
    expect(lines.slice(3).join('\r\n')).toBe('2026-10-03;Taxi;Transporte;Gasto;Pareja;-48900;"ida\nvuelta"');
  });

  it('only writes the header when there are no rows', () => {
    expect(buildTransactionsCsv([], 'you')).toBe(`${BOM}Fecha;Concepto;Categoría;Tipo;Quién;Monto;Nota`);
  });
});
