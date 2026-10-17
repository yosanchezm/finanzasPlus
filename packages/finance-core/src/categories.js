// Category identity shared by the web app and Nia: two names are the same category when they
// fold to the same text, and an archived category (merged or deleted) is never offered or matched.

/** Comparable form of a category name: no accents, lower case, single spaces. */
export const foldCategoryName = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/** The categories that can still be picked: every one that is not archived. */
export const activeCategories = (categories) => (categories || []).filter((category) => !category.archived);

/** Active category by id ($id from Appwrite or id from a snapshot) or by folded name; null when none. */
export const findActiveCategory = (categories, nameOrId) => {
  const value = String(nameOrId ?? '').trim();
  if (!value) return null;
  const active = activeCategories(categories);
  const folded = foldCategoryName(value);
  return active.find((category) => (category.$id ?? category.id) === value)
    || active.find((category) => foldCategoryName(category.name) === folded)
    || null;
};
