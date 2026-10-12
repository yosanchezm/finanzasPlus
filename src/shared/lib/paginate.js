/** Slices `items` for a 1-based `page`, clamping out-of-range pages. Bounds are 1-based and inclusive. */
export const paginate = (items, page, pageSize) => {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const offset = (current - 1) * pageSize;
  const pageItems = items.slice(offset, offset + pageSize);
  return {
    pageItems,
    page: current,
    pageCount,
    start: total ? offset + 1 : 0,
    end: offset + pageItems.length,
    total,
  };
};
