// @vitest-environment node
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng, renderBrandIcon } from './brandIcon.mjs';

const pixel = ({ width, data }, x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

describe('renderBrandIcon', () => {
  it('draws a mint plus on the dark square', () => {
    const icon = renderBrandIcon(64);

    expect(icon.width).toBe(64);
    expect(pixel(icon, 32, 32)).toEqual([0x8c, 0xe6, 0xbd, 255]);
    expect(pixel(icon, 8, 32)).toEqual([0x0f, 0x1a, 0x15, 255]);
    expect(pixel(icon, 32, 8)).toEqual([0x0f, 0x1a, 0x15, 255]);
  });

  it('leaves the corners transparent when rounded and fills them for full-bleed icons', () => {
    expect(pixel(renderBrandIcon(64), 0, 0)[3]).toBe(0);
    expect(pixel(renderBrandIcon(64, { rounded: false }), 0, 0)).toEqual([0x0f, 0x1a, 0x15, 255]);
  });
});

describe('encodePng', () => {
  it('writes a valid PNG whose IHDR and pixel rows match the image', () => {
    const icon = renderBrandIcon(16);
    const png = encodePng(icon);

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(16);
    expect(png.readUInt32BE(20)).toBe(16);
    const idatStart = png.indexOf('IDAT') + 4;
    const idatLength = png.readUInt32BE(idatStart - 8);
    const raw = inflateSync(png.subarray(idatStart, idatStart + idatLength));
    expect(raw.length).toBe(16 * (1 + 16 * 4));
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND');
  });
});
