import { FileText, GitCompareArrows, Home, Receipt, Sparkles, Target, Wallet } from 'lucide-react';

/** Categorical palette. Every category color shown in the UI is one of these. */
export const CATEGORY_PALETTE = ['#1F4E8C', '#0B6E4F', '#E8875A', '#7A5AF8', '#C99A2E', '#A7B0AB'];

/** Spanish names for the palette swatches (used as accessible labels). */
export const PALETTE_NAMES = {
  '#1F4E8C': 'Azul',
  '#0B6E4F': 'Verde',
  '#E8875A': 'Naranja',
  '#7A5AF8': 'Morado',
  '#C99A2E': 'Mostaza',
  '#A7B0AB': 'Gris',
};

/**
 * Pastels stored by older seeds (src/appwrite.js createDefaultCategories and the Nia function),
 * mapped to the palette color with the closest hue. #73d8ff (cyan) would land on blue,
 * which the seed already uses for "Hogar"; it maps to grey instead to keep the seeded set distinct.
 */
const LEGACY_COLORS = {
  '#88b8ff': '#1F4E8C',
  '#f5c96b': '#C99A2E',
  '#8ce6bd': '#0B6E4F',
  '#73f0b5': '#0B6E4F',
  '#ff9a7a': '#E8875A',
  '#bb9cff': '#7A5AF8',
  '#73d8ff': '#A7B0AB',
};

const hashString = (value) => [...String(value)].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);

/** Display color of a category: palette color as stored, legacy pastel mapped by hue, else stable pick by id. */
export const categoryColor = (category) => {
  const stored = String(category?.color || '').trim().toLowerCase();
  const paletteMatch = CATEGORY_PALETTE.find((color) => color.toLowerCase() === stored);
  if (paletteMatch) return paletteMatch;
  if (LEGACY_COLORS[stored]) return LEGACY_COLORS[stored];
  return CATEGORY_PALETTE[hashString(category?.$id || category?.name || '') % CATEGORY_PALETTE.length];
};

/** Icon keys understood by iconForCategory, offered when creating a category. */
export const CATEGORY_ICON_OPTIONS = [
  { value: 'home', label: 'Hogar' },
  { value: 'transport', label: 'Transporte' },
  { value: 'sparkles', label: 'Ocio' },
  { value: 'file', label: 'Servicios' },
  { value: 'target', label: 'Ahorro' },
  { value: 'wallet', label: 'Ingresos' },
  { value: 'receipt', label: 'Recibo' },
];

export const iconForCategory = (category = {}) => {
  const value = `${category.icon || ''} ${category.name || ''}`.toLowerCase();
  if (value.includes('home') || value.includes('hogar')) return Home;
  if (value.includes('transport') || value.includes('transporte')) return GitCompareArrows;
  if (value.includes('spark') || value.includes('ocio')) return Sparkles;
  if (value.includes('file') || value.includes('servicio')) return FileText;
  if (value.includes('target') || value.includes('ahorro')) return Target;
  if (value.includes('wallet') || value.includes('ingreso')) return Wallet;
  return Receipt;
};
