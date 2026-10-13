// One-off generator for the PNG fallbacks of public/favicon.svg. Uses only Node built-ins.
// Run with `npm run icons` after changing the brand mark; the PNGs are committed in public/.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng, renderBrandIcon } from './icons/brandIcon.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

const outputs = [
  // iOS applies its own corner mask, so the touch icon is full-bleed.
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
];

for (const { file, size, rounded } of outputs) {
  writeFileSync(`${publicDir}${file}`, encodePng(renderBrandIcon(size, { rounded })));
  console.log(`✓ public/${file} (${size}×${size})`);
}
