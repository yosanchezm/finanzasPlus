import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, categoryColor } from './categories';

describe('categoryColor', () => {
  it('keeps palette colors, ignoring case', () => {
    expect(categoryColor({ $id: 'a', color: '#7A5AF8' })).toBe('#7A5AF8');
    expect(categoryColor({ $id: 'a', color: '#0b6e4f' })).toBe('#0B6E4F');
  });

  it('maps the legacy seed pastels to their palette equivalent by hue', () => {
    expect(categoryColor({ $id: 'a', color: '#88b8ff' })).toBe('#1F4E8C');
    expect(categoryColor({ $id: 'a', color: '#f5c96b' })).toBe('#C99A2E');
    expect(categoryColor({ $id: 'a', color: '#8ce6bd' })).toBe('#0B6E4F');
    expect(categoryColor({ $id: 'a', color: '#ff9a7a' })).toBe('#E8875A');
    expect(categoryColor({ $id: 'a', color: '#BB9CFF' })).toBe('#7A5AF8');
    expect(categoryColor({ $id: 'a', color: '#73f0b5' })).toBe('#0B6E4F');
  });

  it('picks a stable palette color from the id for unknown or missing colors', () => {
    const first = categoryColor({ $id: 'cat-123', color: '#123456' });

    expect(CATEGORY_PALETTE).toContain(first);
    expect(categoryColor({ $id: 'cat-123', color: '#123456' })).toBe(first);
    expect(categoryColor({ $id: 'cat-123' })).toBe(first);
    const spread = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(($id) => categoryColor({ $id })));
    expect(spread.size).toBeGreaterThan(1);
  });

  it('handles a missing category', () => {
    expect(CATEGORY_PALETTE).toContain(categoryColor(undefined));
  });
});
