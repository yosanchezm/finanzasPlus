import { describe, expect, it } from 'vitest';
import { paginate } from './paginate';

const items = Array.from({ length: 48 }, (_, index) => index + 1);

describe('paginate', () => {
  it('returns the requested page with 1-based bounds', () => {
    expect(paginate(items, 1, 25)).toMatchObject({ page: 1, pageCount: 2, start: 1, end: 25, total: 48 });
    expect(paginate(items, 2, 25)).toMatchObject({ page: 2, start: 26, end: 48 });
    expect(paginate(items, 2, 25).pageItems).toEqual(items.slice(25));
  });

  it('clamps out-of-range pages', () => {
    expect(paginate(items, 9, 25).page).toBe(2);
    expect(paginate(items, 0, 25).page).toBe(1);
  });

  it('handles an empty list', () => {
    expect(paginate([], 1, 25)).toEqual({ pageItems: [], page: 1, pageCount: 1, start: 0, end: 0, total: 0 });
  });
});
