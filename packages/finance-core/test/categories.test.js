// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { activeCategories, findActiveCategory, foldCategoryName } from '../index.js';

const categories = [
  { $id: 'a', name: 'Alimentación' },
  { $id: 'b', name: 'Salud y Cuidado Personal' },
  { $id: 'c', name: 'Comida', archived: true },
  { id: 'd', name: 'Hogar' },
];

describe('foldCategoryName', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(foldCategoryName('  ALIMENTACIÓN ')).toBe('alimentacion');
    expect(foldCategoryName('Salud  y   cuidado personal')).toBe(foldCategoryName('Salud y Cuidado Personal'));
    expect(foldCategoryName(null)).toBe('');
  });
});

describe('activeCategories', () => {
  it('leaves archived categories out', () => {
    expect(activeCategories(categories).map((item) => item.name)).toEqual(['Alimentación', 'Salud y Cuidado Personal', 'Hogar']);
    expect(activeCategories(undefined)).toEqual([]);
  });
});

describe('findActiveCategory', () => {
  it('matches by id (Appwrite $id or plain id) or by folded name', () => {
    expect(findActiveCategory(categories, 'a')?.name).toBe('Alimentación');
    expect(findActiveCategory(categories, 'd')?.name).toBe('Hogar');
    expect(findActiveCategory(categories, 'alimentacion')?.name).toBe('Alimentación');
    expect(findActiveCategory(categories, 'salud y cuidado PERSONAL')?.name).toBe('Salud y Cuidado Personal');
  });

  it('never returns an archived category, nor anything for an unknown or empty name', () => {
    expect(findActiveCategory(categories, 'Comida')).toBeNull();
    expect(findActiveCategory(categories, 'c')).toBeNull();
    expect(findActiveCategory(categories, 'Mercado')).toBeNull();
    expect(findActiveCategory(categories, '')).toBeNull();
  });
});
