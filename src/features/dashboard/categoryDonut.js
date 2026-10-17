/**
 * Slot colors of the spending donut, in fixed order: the biggest slice always takes slot 1.
 * Colored by position, not by category, so every pair of neighbouring slices stays distinguishable
 * (validated with the dataviz palette checks: adjacent CVD ΔE >= 9.1, normal vision >= 19.6 on white).
 * Identity is carried by the legend, which always names each slice.
 */
export const DONUT_SLOT_COLORS = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4'];

/** Recessive grey of the folded tail; lighter than the slots so it never reads as a sixth category. */
export const OTHER_COLOR = '#C4CBC6';
export const OTHER_KEY = 'otros';

const byValueThenName = (a, b) => b.value - a.value || a.name.localeCompare(b.name, 'es');

/**
 * Donut slices of the categories with spending: the 5 biggest by name, the rest folded into "Otros"
 * (whose `members` keep the folded categories for the legend). `share` is the fraction of the total.
 */
export const buildDonutSlices = (stats = []) => {
  const spent = (stats || [])
    .map((item) => ({ categoryId: item.$id, name: item.name, value: Number(item.value) || 0 }))
    .filter((item) => item.value > 0)
    .sort(byValueThenName);
  const total = spent.reduce((sum, item) => sum + item.value, 0);
  if (!total) return { total: 0, slices: [] };

  const withShare = (item) => ({ ...item, share: item.value / total });
  const named = spent.slice(0, DONUT_SLOT_COLORS.length)
    .map((item, index) => ({ ...withShare(item), key: item.categoryId, color: DONUT_SLOT_COLORS[index] }));
  const tail = spent.slice(DONUT_SLOT_COLORS.length).map(withShare);
  if (!tail.length) return { total, slices: named };

  const value = tail.reduce((sum, item) => sum + item.value, 0);
  const other = { key: OTHER_KEY, categoryId: null, name: 'Otros', value, share: value / total, color: OTHER_COLOR, members: tail };
  return { total, slices: [...named, other] };
};
