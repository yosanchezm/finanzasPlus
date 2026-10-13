// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const pngSize = (path) => {
  const png = readFileSync(resolve(root, path));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

describe('favicon', () => {
  it('is an SVG brand mark: dark rounded square (8/32 radius) with a mint plus and an outline for dark tabs', () => {
    const svg = read('public/favicon.svg');

    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toMatch(/<rect[^>]*rx="8"[^>]*fill="#0F1A15"/);
    expect(svg).toMatch(/stroke="#8CE6BD"/);
    expect(svg).toMatch(/<rect[^>]*stroke=/);
  });

  it('is linked from index.html together with the manifest and the touch icon', () => {
    const html = read('index.html');

    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">');
  });
});

describe('web manifest', () => {
  const manifest = JSON.parse(read('public/site.webmanifest'));

  it('describes the installed app', () => {
    expect(manifest).toMatchObject({
      name: 'finanzas+',
      short_name: 'finanzas+',
      theme_color: '#0F1A15',
      background_color: '#0F1A15',
      display: 'standalone',
      start_url: '/',
    });
  });

  it('lists the SVG icon and PNG fallbacks that exist with the declared sizes', () => {
    expect(manifest.icons).toContainEqual({ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' });
    for (const size of [192, 512]) {
      const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
      expect(icon).toMatchObject({ type: 'image/png', purpose: 'any' });
      expect(pngSize(`public${icon.src}`)).toEqual({ width: size, height: size });
    }
    expect(pngSize('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });
});

describe('nginx', () => {
  it('serves the manifest with its MIME type (nginx has no default mapping for .webmanifest)', () => {
    const config = read('nginx.conf');

    expect(config).toMatch(/location = \/site\.webmanifest \{[^}]*application\/manifest\+json/);
    expect(existsSync(resolve(root, 'public/favicon.svg'))).toBe(true);
  });
});
