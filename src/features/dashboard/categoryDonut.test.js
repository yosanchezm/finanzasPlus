import { describe, expect, it } from 'vitest';
import { DONUT_SLOT_COLORS, OTHER_COLOR, OTHER_KEY, buildDonutSlices } from './categoryDonut';

const stat = (id, name, value) => ({ $id: id, name, value });

describe('buildDonutSlices', () => {
  it('names the 5 biggest categories in slot order and folds the rest into Otros', () => {
    const { total, slices } = buildDonutSlices([
      stat('a', 'Mercado', 100), stat('b', 'Hogar', 700), stat('c', 'Ocio', 50), stat('d', 'Tecnología', 300),
      stat('e', 'Transporte', 200), stat('f', 'Salud', 400), stat('g', 'Jardinería', 25), stat('h', 'Vacía', 0),
    ]);

    expect(total).toBe(1775);
    expect(slices.map((slice) => slice.name)).toEqual(['Hogar', 'Salud', 'Tecnología', 'Transporte', 'Mercado', 'Otros']);
    expect(slices.slice(0, 5).map((slice) => slice.color)).toEqual(DONUT_SLOT_COLORS);
    expect(slices[0]).toMatchObject({ key: 'b', categoryId: 'b', value: 700, share: 700 / 1775 });
    expect(slices[5]).toMatchObject({ key: OTHER_KEY, categoryId: null, value: 75, color: OTHER_COLOR });
    expect(slices[5].members.map((member) => [member.name, member.categoryId, member.value])).toEqual([['Ocio', 'c', 50], ['Jardinería', 'g', 25]]);
  });

  it('shows every category without Otros when there are 5 or fewer', () => {
    const { slices } = buildDonutSlices([stat('a', 'Mercado', 10), stat('b', 'Hogar', 30)]);

    expect(slices.map((slice) => [slice.name, slice.color])).toEqual([['Hogar', DONUT_SLOT_COLORS[0]], ['Mercado', DONUT_SLOT_COLORS[1]]]);
  });

  it('breaks ties by name so the order and the colors are stable', () => {
    const first = buildDonutSlices([stat('a', 'Zapatos', 10), stat('b', 'Agua', 10)]).slices.map((slice) => slice.name);
    const second = buildDonutSlices([stat('b', 'Agua', 10), stat('a', 'Zapatos', 10)]).slices.map((slice) => slice.name);

    expect(first).toEqual(['Agua', 'Zapatos']);
    expect(second).toEqual(first);
  });

  it('returns nothing to draw when no category has spending', () => {
    expect(buildDonutSlices([stat('a', 'Mercado', 0)])).toEqual({ total: 0, slices: [] });
    expect(buildDonutSlices(undefined)).toEqual({ total: 0, slices: [] });
  });

  it('draws consumption categories only: saving, investment, debt and income never appear', () => {
    const kinded = (id, name, value, kind) => ({ ...stat(id, name, value), kind });
    const { total, slices } = buildDonutSlices([
      kinded('a', 'Mercado', 100, 'need'), kinded('b', 'Ocio', 50, 'want'), kinded('c', 'Ahorro', 900, 'saving'),
      kinded('d', 'Fondo', 800, 'investment'), kinded('e', 'Tarjeta', 700, 'debt'), stat('f', 'Sin tipo', 25),
    ]);

    expect(slices.map((slice) => slice.name)).toEqual(['Mercado', 'Ocio', 'Sin tipo']);
    expect(total).toBe(175);
  });
});
