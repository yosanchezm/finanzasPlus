// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findDebt, fold } from './findDebt.js';

const debt = (id, name, extra = {}) => ({ $id: id, name, lender: '', kind: 'consumer', status: 'active', ...extra });

const car = debt('d1', 'Crédito Vehículo', { kind: 'vehicle', lender: 'Bancolombia' });
const house = debt('d2', 'Hipoteca casa', { kind: 'mortgage', lender: 'Davivienda' });
const libre = debt('d3', 'Libre inversión', { kind: 'consumer', lender: 'Banco de Bogotá' });

describe('fold', () => {
  it('lowercases, strips accents and collapses spaces', () => {
    expect(fold('  Crédito   VEHÍCULO ')).toBe('credito vehiculo');
    expect(fold('Ñandú')).toBe('nandu');
  });

  it('is safe for missing values', () => {
    expect(fold(undefined)).toBe('');
    expect(fold(null)).toBe('');
  });
});

describe('findDebt', () => {
  it('matches a name ignoring case and accents ("vehiculo" finds "Crédito Vehículo")', () => {
    expect(findDebt([car, house], 'vehiculo')).toEqual({ match: car });
    expect(findDebt([car, house], 'HIPOTECA')).toEqual({ match: house });
  });

  it('prefers an exact name over a debt that merely contains the words', () => {
    const exact = debt('d4', 'Carro');
    const longer = debt('d5', 'Carro de la familia');

    expect(findDebt([longer, exact], 'carro')).toEqual({ match: exact });
  });

  it('prefers a name or lender match over a kind synonym', () => {
    const other = debt('d6', 'Préstamo amigo', { kind: 'vehicle' });
    const byName = debt('d7', 'Moto nueva', { kind: 'other' });

    // "moto" is a synonym of the vehicle kind (other) but also part of a name (byName).
    expect(findDebt([other, byName], 'moto')).toEqual({ match: byName });
  });

  it('matches the lender', () => {
    expect(findDebt([car, house], 'davivienda')).toEqual({ match: house });
  });

  it('falls back to the kind synonyms when no name or lender matches', () => {
    expect(findDebt([car, house], 'el carro')).toEqual({ match: car });
    expect(findDebt([car, house], 'la hipoteca')).toEqual({ match: house });
  });

  it('returns the candidates when several debts match ("banco")', () => {
    const result = findDebt([car, house, libre], 'banco'); // Bancolombia and Banco de Bogotá

    expect(result.match).toBeUndefined();
    expect(result.candidates).toEqual([car, libre]);
  });

  it('lists both when two lenders contain the word', () => {
    const second = debt('d8', 'Moto', { lender: 'Banco Caja Social', kind: 'vehicle' });
    const result = findDebt([libre, second, house], 'banco');

    expect(result.candidates.map((item) => item.$id)).toEqual(['d3', 'd8']);
  });

  it('caps the candidates at 6', () => {
    const many = Array.from({ length: 9 }, (_, index) => debt(`m${index}`, `Banco ${index}`));

    expect(findDebt(many, 'banco').candidates).toHaveLength(6);
  });

  it('uses the only active debt when nothing matches', () => {
    expect(findDebt([car], 'la deuda de mi hermano')).toEqual({ match: car });
    expect(findDebt([car], '')).toEqual({ match: car });
  });

  it('ignores archived and closed debts for the fallback and the matching', () => {
    const closed = debt('d9', 'Crédito Vehículo viejo', { status: 'closed' });
    const archived = debt('d10', 'Otro', { status: 'archived' });

    expect(findDebt([car, closed, archived], 'nada que ver')).toEqual({ match: car });
    expect(findDebt([car, closed], 'vehiculo')).toEqual({ match: car });
  });

  it('answers none when nothing matches and several debts are active', () => {
    expect(findDebt([car, house], 'la deuda de mi hermano')).toEqual({ none: true });
    expect(findDebt([car, house], '')).toEqual({ none: true });
  });

  it('answers none when there are no debts at all', () => {
    expect(findDebt([], 'vehiculo')).toEqual({ none: true });
  });
});
